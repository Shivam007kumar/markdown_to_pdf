import re
import zlib
import base64
import urllib.parse
from markdown_it import MarkdownIt

# Industrial-grade regex for fenced code blocks (Mermaid/Diagrams)
# Handles up to 3 leading spaces, different newlines, and multiple blocks in one file
DIAGRAM_RE = re.compile(
    r'^[ \t]{0,3}```(mermaid|plantuml|d2|excalidraw|graphviz|structurizr)[ \t]*[\r\n]+(.*?)[ \t]{0,3}```',
    flags=re.DOTALL | re.MULTILINE
)

MATH_BLOCK_RE = re.compile(r'(?<!\\)\$\$(.*?)\$\$', flags=re.DOTALL)
MATH_INLINE_RE = re.compile(r'(?<!\\)\$(?!\s)(.*?)(?<!\s)\$', flags=re.DOTALL)

# Initialize the MarkdownIt parser
# We enable generic markdown features and HTML to allow rendering complex markdown.
# Fix: Removed the broken texmath_plugin which was destructively stripping standard math wrappers 
md = (
    MarkdownIt('gfm-like', {'breaks': True, 'html': True})
    .enable('table')
)

def convert(markdown_text: str) -> str:
    """
    Convert Markdown text to HTML using markdown-it-py.
    Processes math natively via regex and Mermaid via external API.
    """
    
    # First, handle diagram blocks (mermaid, d2, plantuml) using Kroki API.
    # We now use POST + Data URIs to bypass URL length limits and WeasyPrint network issues.
    def replace_diagram(match):
        diagram_type = match.group(1).strip()
        # De-indent the code block to handle diagrams copied from nested documents/lists
        import textwrap
        code = textwrap.dedent(match.group(2).strip())
        
        import urllib.request
        import ssl
        import certifi
        import base64
        
        url = f'https://kroki.io/{diagram_type}/png'
        try:
            # We explicitly set a User-Agent and use POST to handle large diagrams reliably
            ctx = ssl.create_default_context(cafile=certifi.where())
            headers = {
                'Content-Type': 'text/plain',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            req = urllib.request.Request(url, data=code.encode('utf-8'), headers=headers)
            with urllib.request.urlopen(req, context=ctx, timeout=15) as response:
                img_data = response.read()
                b64_img = base64.b64encode(img_data).decode('utf-8')
                return f'\n<div class="diagram-container" style="text-align: center; margin: 1.5em 0;"><img src="data:image/png;base64,{b64_img}" class="diagram-{diagram_type}" style="max-width: 100%; object-fit: contain;"/></div>\n'
        except Exception as e:
            error_msg = str(e)
            # Try to get the specific reason from the Kroki response body
            if hasattr(e, 'read'):
                try:
                    error_msg = e.read().decode('utf-8')
                except:
                    pass
            
            # Compact error block — NO borders (they bleed across page breaks in WeasyPrint).
            # Uses only background-color which clips cleanly at page boundaries.
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

    markdown_text = DIAGRAM_RE.sub(replace_diagram, markdown_text)

    # Next, handle LaTeX Math formulas safely via highly strict regex BEFORE Markdown parsing
    # Convert them to raw HTML images so markdown-it-py processes them natively without destroying strings
    def replace_block_math(match):
        math_content = match.group(1).strip()
        encoded = urllib.parse.quote(math_content)
        return f'\n<div class="katex-display" style="text-align: center; margin: 1.5em 0;"><img src="https://latex.codecogs.com/png.image?%5Cdpi%7B300%7D%5Cbg_white%5Ccolor%7Bblack%7D{encoded}" style="max-width: 100%;" alt="math" /></div>\n'

    def replace_inline_math(match):
        math_content = match.group(1).strip()
        encoded = urllib.parse.quote(math_content)
        return f'<img src="https://latex.codecogs.com/png.image?%5Cdpi%7B300%7D%5Cbg_white%5Ccolor%7Bblack%7D{encoded}" style="vertical-align: middle; height: 1.25em;" alt="math" class="katex" />'

    markdown_text = MATH_BLOCK_RE.sub(replace_block_math, markdown_text)
    markdown_text = MATH_INLINE_RE.sub(replace_inline_math, markdown_text)

    # Render finalizing HTML
    html = md.render(markdown_text)
    
    return html
