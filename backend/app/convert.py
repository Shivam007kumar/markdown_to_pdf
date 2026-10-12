import re
import zlib
import base64
import urllib.parse
import asyncio
import httpx
import textwrap
import uuid
from html.parser import HTMLParser
from markdown_it import MarkdownIt

# Industrial-grade regex for fenced code blocks (Mermaid/Diagrams)
DIAGRAM_RE = re.compile(
    r'^[ \t]{0,3}```(mermaid|plantuml|d2|excalidraw|graphviz|structurizr)[ \t]*[\r\n]+(.*?)[ \t]{0,3}```',
    flags=re.DOTALL | re.MULTILINE
)

# Regex to catch all remaining code blocks (fenced and inline) to mask them from math parsing
GENERAL_CODE_RE = re.compile(r'(```.*?```|`[^`\n]+`)', flags=re.DOTALL)

MATH_BLOCK_DOLLAR_RE = re.compile(r'(?<!\\)\$\$(.*?)\$\$', flags=re.DOTALL)
MATH_BLOCK_BRACKET_RE = re.compile(r'\\\\?\[(.*?)\\\\?\]', flags=re.DOTALL)

MATH_INLINE_DOLLAR_RE = re.compile(r'(?<!\\)\$(?!\s)(.*?)(?<!\s)\$')
MATH_INLINE_PAREN_RE = re.compile(r'\\\\?\((.*?)\\\\?\)')

# Initialize the MarkdownIt parser
md = (
    MarkdownIt('gfm-like', {'breaks': True, 'html': True})
    .enable('table')
)

async def fetch_diagram(client, diagram_type, code):
    try:
        if diagram_type == 'mermaid':
            import json
            data = {'code': code, 'mermaid': {'theme': 'default'}}
            # Use url-safe base64 for mermaid.ink to prevent character issues
            b64_payload = base64.urlsafe_b64encode(json.dumps(data).encode('utf-8')).decode('utf-8')
            url = f'https://mermaid.ink/img/{b64_payload}'
            resp = await client.get(url, headers={'User-Agent': 'Mozilla/5.0'})
        else:
            url = f'https://kroki.io/{diagram_type}/png'
            resp = await client.post(
                url, 
                content=code.encode('utf-8'), 
                headers={'Content-Type': 'text/plain', 'User-Agent': 'Mozilla/5.0'}
            )
            
        resp.raise_for_status()
        b64 = base64.b64encode(resp.content).decode('utf-8')
        return f'\n<div class="diagram-container" style="text-align: center; margin: 1.5em 0;"><img src="data:image/png;base64,{b64}" class="diagram-{diagram_type}" style="max-width: 100%; object-fit: contain;"/></div>\n'
    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        safe_error = error_msg.replace('<', '&lt;').replace('>', '&gt;')[:500]
        return (
            f'\n<div style="background:#fee2e2;padding:0.8em 1em;border-radius:6px;'
            f'margin:1em 0;page-break-inside:avoid;">'
            f'<p style="color:#991b1b;font-weight:bold;font-size:0.9em;margin:0 0 0.3em 0;">'
            f'&#10060; Diagram rendering failed</p>'
            f'<p style="color:#7f1d1d;font-size:0.78em;margin:0;'
            f'white-space:pre-wrap;word-break:break-word;">{safe_error}</p>'
            f'</div>\n'
        )

def batch_render_latex(math_items: list[dict]) -> dict[str, str]:
    """
    Renders a batch of LaTeX formulas to HTML using local KaTeX via Node.js
    (installed in frontend/node_modules/katex). Falls back gracefully to latex2mathml
    if Node/KaTeX is unavailable or fails.
    """
    if not math_items:
        return {}

    rendered_map = {}
    
    # Try high-quality local KaTeX rendering first
    try:
        import json
        import subprocess
        from pathlib import Path

        # Check frontend/node_modules/katex relative to backend
        katex_path = Path(__file__).resolve().parent.parent.parent / "frontend" / "node_modules" / "katex"
        node_script = (
            f'const k=require("{katex_path}"); '
            'let data=""; '
            'process.stdin.on("data", c=>data+=c); '
            'process.stdin.on("end", ()=>{ '
            '  try { '
            '    const list=JSON.parse(data); '
            '    const out=list.map(x=>({id:x.id, html:k.renderToString(x.math, {displayMode:x.is_block, output:"html", throwOnError:false})})); '
            '    process.stdout.write(JSON.stringify(out)); '
            '  } catch(e) { process.stderr.write(String(e)); } '
            '});'
        )

        p = subprocess.Popen(
            ["node", "-e", node_script],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = p.communicate(input=json.dumps(math_items), timeout=10.0)
        if p.returncode == 0 and stdout:
            results = json.loads(stdout)
            for item in results:
                rendered_map[item["id"]] = item["html"]
    except Exception:
        # Fall back to latex2mathml
        pass

    # For any formulas not yet rendered, use latex2mathml as robust fallback
    for item in math_items:
        uid = item["id"]
        if uid in rendered_map:
            continue
        content = item["math"]
        is_block = item["is_block"]
        try:
            import latex2mathml.converter
            display = "block" if is_block else "inline"
            mathml = latex2mathml.converter.convert(content, display=display)
            if is_block:
                rendered_map[uid] = f'\n<div class="math-display">{mathml}</div>\n'
            else:
                rendered_map[uid] = mathml
        except Exception:
            escaped = content.replace("<", "&lt;").replace(">", "&gt;")
            if is_block:
                rendered_map[uid] = f'\n<pre class="math-error"><code>{escaped}</code></pre>\n'
            else:
                rendered_map[uid] = f'<code class="math-error">{escaped}</code>'

    return rendered_map


async def convert(markdown_text: str) -> str:
    """
    Convert Markdown text to HTML using markdown-it-py.
    Processes Mermaid diagrams asynchronously, and converts LaTeX to MathML
    locally without external network requests.
    """
    diagram_tasks = {}

    def diag_repl(m):
        uid = f"__DIAG_UUID_{uuid.uuid4().hex}__"
        dtype = m.group(1).strip()
        code = textwrap.dedent(m.group(2).strip())
        diagram_tasks[uid] = (dtype, code)
        return uid

    markdown_text = DIAGRAM_RE.sub(diag_repl, markdown_text)

    # Mask remaining code blocks so the math regex ignores $ and math delimiters inside them
    code_tasks = {}
    def code_repl(m):
        uid = f"__CODE_UUID_{uuid.uuid4().hex}__"
        code_tasks[uid] = m.group(1)
        return uid
        
    markdown_text = GENERAL_CODE_RE.sub(code_repl, markdown_text)

    # Collect math expressions and replace with clean alphanumeric placeholders
    # so markdown-it-py handles inline formatting (like **$math$**) without breaking HTML
    math_items = []

    def block_repl(m):
        uid = f"MATHBLOCKUUID{uuid.uuid4().hex}"
        math_items.append({"id": uid, "math": m.group(1).strip(), "is_block": True})
        return uid

    markdown_text = MATH_BLOCK_DOLLAR_RE.sub(block_repl, markdown_text)
    markdown_text = MATH_BLOCK_BRACKET_RE.sub(block_repl, markdown_text)

    def inline_repl(m):
        uid = f"MATHINLINEUUID{uuid.uuid4().hex}"
        math_items.append({"id": uid, "math": m.group(1).strip(), "is_block": False})
        return uid

    markdown_text = MATH_INLINE_DOLLAR_RE.sub(inline_repl, markdown_text)
    markdown_text = MATH_INLINE_PAREN_RE.sub(inline_repl, markdown_text)

    # Batch render all math formulas in one quick process
    math_placeholders = batch_render_latex(math_items)

    # Process diagrams (Mermaid, etc.) if any are present
    if diagram_tasks:
        async with httpx.AsyncClient(timeout=15.0) as client:
            uids = list(diagram_tasks.keys())
            awaitables = [
                fetch_diagram(client, diagram_tasks[uid][0], diagram_tasks[uid][1])
                for uid in uids
            ]
            results = await asyncio.gather(*awaitables)
            for uid, html_result in zip(uids, results):
                markdown_text = markdown_text.replace(uid, html_result)

    # Restore the masked code blocks exactly as they were
    for uid, original_code in code_tasks.items():
        markdown_text = markdown_text.replace(uid, original_code)

    # Render Markdown to HTML
    html = md.render(markdown_text)

    # Safely substitute MathML output after markdown rendering to avoid HTML escaping inside bold/italic
    for uid, mathml_output in math_placeholders.items():
        html = html.replace(uid, mathml_output)

    # Post-process: wrap wide tables (>5 columns) in a landscape div
    html = wrap_wide_tables(html)

    return html


class _TableColumnCounter(HTMLParser):
    """Lightweight SAX-style parser that counts max columns in each <table>."""
    def __init__(self):
        super().__init__()
        self.in_table = False
        self.in_row = False
        self.current_row_cols = 0
        self.max_cols = 0
        self.tables = []  # list of max_cols per table

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.in_table = True
            self.max_cols = 0
        elif tag == 'tr' and self.in_table:
            self.in_row = True
            self.current_row_cols = 0
        elif tag in ('th', 'td') and self.in_row:
            # Respect colspan attribute
            span = 1
            for k, v in attrs:
                if k == 'colspan':
                    try:
                        span = int(v)
                    except ValueError:
                        pass
            self.current_row_cols += span

    def handle_endtag(self, tag):
        if tag == 'tr' and self.in_row:
            self.in_row = False
            self.max_cols = max(self.max_cols, self.current_row_cols)
        elif tag == 'table':
            self.in_table = False
            self.tables.append(self.max_cols)


WIDE_TABLE_THRESHOLD = 5  # columns > this value triggers landscape

def wrap_wide_tables(html: str) -> str:
    """
    Scan all <table> elements in html. Any table whose max column count exceeds
    WIDE_TABLE_THRESHOLD gets wrapped in <div class="landscape-table">.</div>.
    Uses only stdlib html.parser — no extra dependencies.
    """
    counter = _TableColumnCounter()
    counter.feed(html)

    if not counter.tables:
        return html

    # Walk through the HTML and wrap wide tables
    # We iterate over each <table>...</table> block one by one.
    result = []
    table_index = 0
    remaining = html

    while True:
        start = remaining.find('<table')
        if start == -1:
            result.append(remaining)
            break

        # Append everything before this table
        result.append(remaining[:start])

        # Find the matching </table> (handle nesting just in case)
        depth = 0
        pos = start
        while pos < len(remaining):
            if remaining[pos:].lower().startswith('<table'):
                depth += 1
                pos += 6
            elif remaining[pos:].lower().startswith('</table>'):
                depth -= 1
                pos += 8
                if depth == 0:
                    break
            else:
                pos += 1

        table_html = remaining[start:pos]
        remaining = remaining[pos:]

        # Decide whether to wrap
        if table_index < len(counter.tables) and counter.tables[table_index] > WIDE_TABLE_THRESHOLD:
            result.append(f'<div class="landscape-table">{table_html}</div>')
        else:
            result.append(table_html)

        table_index += 1

    return ''.join(result)
