import re
import zlib
import base64
import urllib.parse
import asyncio
import httpx
import textwrap
import uuid
from markdown_it import MarkdownIt

# Industrial-grade regex for fenced code blocks (Mermaid/Diagrams)
DIAGRAM_RE = re.compile(
    r'^[ \t]{0,3}```(mermaid|plantuml|d2|excalidraw|graphviz|structurizr)[ \t]*[\r\n]+(.*?)[ \t]{0,3}```',
    flags=re.DOTALL | re.MULTILINE
)

# Regex to catch all remaining code blocks (fenced and inline) to mask them from math parsing
GENERAL_CODE_RE = re.compile(r'(```.*?```|`[^`\n]+`)', flags=re.DOTALL)

MATH_BLOCK_RE = re.compile(r'(?<!\\)\$\$(.*?)\$\$', flags=re.DOTALL)
MATH_INLINE_RE = re.compile(r'(?<!\\)\$(?!\s)(.*?)(?<!\s)\$')

# Initialize the MarkdownIt parser
md = (
    MarkdownIt('gfm-like', {'breaks': True, 'html': True})
    .enable('table')
)

async def fetch_diagram(client, diagram_type, code):
    url = f'https://kroki.io/{diagram_type}/png'
    try:
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

async def fetch_math(client, content, is_block):
    encoded = urllib.parse.quote(content)
    url = f"https://latex.codecogs.com/svg.image?%5Cbg_white%5Ccolor%7Bblack%7D{encoded}"
    
    try:
        resp = await client.get(url)
        resp.raise_for_status()
        b64 = base64.b64encode(resp.content).decode('utf-8')
        img_src = f"data:image/svg+xml;base64,{b64}"
    except Exception:
        # Fallback to external url if fetching fails
        img_src = url
    
    # Using alt="" and a zero-width space &#8203; so copy-paste skips the formula elegantly
    if is_block:
        return f'\n<div class="katex-display" style="text-align: center; margin: 1.5em 0;"><span style="font-size:0; color:transparent; user-select:none;">&#8203;</span><img src="{img_src}" style="max-width: 100%;" alt="" /></div>\n'
    else:
        return f'<span style="font-size:0; color:transparent; user-select:none;">&#8203;</span><img src="{img_src}" style="vertical-align: middle; height: 1.25em;" alt="" class="katex" />'


async def convert(markdown_text: str) -> str:
    """
    Convert Markdown text to HTML using markdown-it-py.
    Processes math and Mermaid asynchronously before HTML conversion.
    """
    tasks = {}

    def diag_repl(m):
        uid = f"__UUID_{uuid.uuid4().hex}__"
        dtype = m.group(1).strip()
        code = textwrap.dedent(m.group(2).strip())
        tasks[uid] = ('diagram', dtype, code)
        return uid

    markdown_text = DIAGRAM_RE.sub(diag_repl, markdown_text)

    # Mask remaining code blocks so the math regex ignores $ variables inside them
    code_tasks = {}
    def code_repl(m):
        uid = f"__CODE_UUID_{uuid.uuid4().hex}__"
        code_tasks[uid] = m.group(1)
        return uid
        
    markdown_text = GENERAL_CODE_RE.sub(code_repl, markdown_text)

    def block_repl(m):
        uid = f"__UUID_{uuid.uuid4().hex}__"
        tasks[uid] = ('math_block', m.group(1).strip())
        return uid

    markdown_text = MATH_BLOCK_RE.sub(block_repl, markdown_text)

    def inline_repl(m):
        uid = f"__UUID_{uuid.uuid4().hex}__"
        tasks[uid] = ('math_inline', m.group(1).strip())
        return uid

    markdown_text = MATH_INLINE_RE.sub(inline_repl, markdown_text)

    async with httpx.AsyncClient(timeout=15.0) as client:
        # Create tasks
        awaitables = []
        uids = []
        for uid, task_info in tasks.items():
            uids.append(uid)
            if task_info[0] == 'diagram':
                awaitables.append(fetch_diagram(client, task_info[1], task_info[2]))
            elif task_info[0] == 'math_block':
                awaitables.append(fetch_math(client, task_info[1], True))
            elif task_info[0] == 'math_inline':
                awaitables.append(fetch_math(client, task_info[1], False))
                
        if awaitables:
            results = await asyncio.gather(*awaitables)
            for uid, html_result in zip(uids, results):
                markdown_text = markdown_text.replace(uid, html_result)

    # Restore the masked code blocks exactly as they were
    for uid, original_code in code_tasks.items():
        markdown_text = markdown_text.replace(uid, original_code)

    html = md.render(markdown_text)
    return html
