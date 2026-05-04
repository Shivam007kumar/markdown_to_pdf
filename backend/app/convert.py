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

MATH_BLOCK_RE = re.compile(r'(?<!\\)\$\$(.*?)\$\$', flags=re.DOTALL)
MATH_INLINE_RE = re.compile(r'(?<!\\)\$(?!\s)(.*?)(?<!\s)\$', flags=re.DOTALL)

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
        error_msg = str(e)
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
    url = f"https://latex.codecogs.com/png.image?%5Cdpi%7B300%7D%5Cbg_white%5Ccolor%7Bblack%7D{encoded}"
    
    img_width = None
    img_height = None
    
    try:
        resp = await client.get(url)
        resp.raise_for_status()
        
        if is_block:
            try:
                from PIL import Image
                import io
                img = Image.open(io.BytesIO(resp.content))
                # Scale 300 DPI image to standard 96 DPI pixel layout dimensions (1/3.125)
                scale = 96 / 300
                img_width = max(1, int(img.width * scale))
                img_height = max(1, int(img.height * scale))
            except Exception:
                pass
                
        b64 = base64.b64encode(resp.content).decode('utf-8')
        img_src = f"data:image/png;base64,{b64}"
    except Exception:
        # Fallback to external url if fetching fails
        img_src = url
    
    # Using alt="" and a zero-width space &#8203; so copy-paste skips the formula elegantly
    if is_block:
        size_attrs = f'width="{img_width}" height="{img_height}" ' if img_width and img_height else ''
        return f'\n<div class="katex-display" style="text-align: center; margin: 1.5em 0;"><span style="font-size:0; color:transparent; user-select:none;">&#8203;</span><img src="{img_src}" {size_attrs}style="max-width: 100%; height: auto;" alt="" /></div>\n'
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

    html = md.render(markdown_text)
    return html
