import re
import zlib
import base64
import urllib.parse
from markdown_it import MarkdownIt

# Fix: Compile the massive regex once at module level to avoid recompiling on every call
DIAGRAM_RE = re.compile(
    r'```(mermaid|plantuml|d2|excalidraw|graphviz|structurizr)\s*\n(.{0,50000}?)\n```',
    flags=re.DOTALL
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
    
    # First, handle diagram blocks (mermaid, d2, plantuml) using Kroki API
    # because WeasyPrint/HTML won't render JS-based diagrams.
    def replace_diagram(match):
        diagram_type = match.group(1).strip()
        code = match.group(2).strip()
        compressed = zlib.compress(code.encode('utf-8'), 9)
        encoded = base64.urlsafe_b64encode(compressed).decode('utf-8').rstrip('=')
        return f'\n<div style="text-align: center; margin: 1.5em 0;"><img src="https://kroki.io/{diagram_type}/png/{encoded}" class="diagram-{diagram_type}" style="max-width: 100%; object-fit: contain;"/></div>\n'

    # Fix: Placed a hard limit of 50,000 characters and call precompiled module-level regex
    markdown_text = DIAGRAM_RE.sub(replace_diagram, markdown_text)

    # Next, handle LaTeX Math formulas safely via highly strict regex BEFORE Markdown parsing
    # Convert them to raw HTML images so markdown-it-py processes them natively without destroying strings
    def replace_block_math(match):
        math_content = match.group(1).strip()
        encoded = urllib.parse.quote(math_content)
        return f'\n<div class="katex-display" style="text-align: center; margin: 1.5em 0;"><img src="https://latex.codecogs.com/svg.image?{encoded}" style="max-width: 100%;" alt="math" /></div>\n'

    def replace_inline_math(match):
        math_content = match.group(1).strip()
        encoded = urllib.parse.quote(math_content)
        return f'<img src="https://latex.codecogs.com/svg.image?{encoded}" style="vertical-align: middle; height: 1.25em;" alt="math" class="katex" />'

    markdown_text = MATH_BLOCK_RE.sub(replace_block_math, markdown_text)
    markdown_text = MATH_INLINE_RE.sub(replace_inline_math, markdown_text)

    # Render finalizing HTML
    html = md.render(markdown_text)
    
    return html
