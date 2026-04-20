def get_base_styles() -> str:
    """
    Returns the baseline apitemplate-like CSS.
    """
    return """
    @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;700&family=Fira+Code&display=swap');

    @page {
        size: A4;
        margin: 15mm;
    }

    body {
        font-family: 'Barlow', sans-serif;
        font-size: 11pt;
        line-height: 1.6;
        color: #333;
        margin: 0;
        padding: 0;
    }

    h1, h2, h3, h4, h5, h6 {
        font-family: 'Barlow', sans-serif;
        color: #2c3e50;
        margin-top: 1.5em;
    }

    h1 { border-bottom: 2px solid #eee; padding-bottom: 0.3em; }

    code, pre {
        font-family: 'Fira Code', monospace;
        background: #2d2d2d;
        color: #f8f8f2;
        border-radius: 4px;
        font-size: 0.85em;
    }

    code {
        padding: 0.2em 0.4em;
        word-break: break-all;
    }

    pre {
        padding: 1em;
        white-space: pre-wrap !important;
        word-wrap: break-word !important;
        word-break: break-all !important;
    }

    blockquote {
        border-left: 4px solid #dfe2e5;
        color: #6a737d;
        padding: 0 1em;
        margin: 1.5em 0;
    }

    table {
        border-collapse: collapse;
        width: 100%;
        margin: 1.5em 0;
    }

    table th, table td {
        border: 1px solid #dfe2e5;
        padding: 6px 13px;
    }

    table tr:nth-child(2n) {
        background-color: #f6f8fa;
    }

    ul {
        list-style-type: disc;
        padding-left: 2rem;
        margin: 1em 0;
    }

    ol {
        list-style-type: decimal;
        padding-left: 2rem;
        margin: 1em 0;
    }

    li {
        margin-top: 0.25em;
        margin-bottom: 0.25em;
    }

    ul ul, ul ol, ol ul, ol ol {
        margin-top: 0;
        margin-bottom: 0;
    }

    .katex-display {
        margin: 1.5em 0;
        padding: 0.5em 0;
    }

    .katex {
        font-size: 1.05em;
        padding: 0 0.1em;
    }

    /* Print Controls */
    p, blockquote, pre, table, .katex-display, ul, ol, img {
        page-break-inside: avoid;
        break-inside: avoid;
    }

    img {
        max-width: 100%;
        max-height: 90vh;
        object-fit: contain;
        height: auto;
    }

    p, li {
        orphans: 3;
        widows: 3;
    }
    """

def build_styles(custom: str = "") -> str:
    """
    Combines base styles with custom user CSS.
    """
    base = get_base_styles()
    return f"{base}\n\n/* Custom User Overrides */\n{custom}"
