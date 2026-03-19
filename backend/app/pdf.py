from weasyprint import HTML

def to_pdf(html_content: str, stylesheet: str = None) -> bytes:
    """
    Convert HTML content to PDF using WeasyPrint.
    Accepts an optional CSS string.
    """
    # WeasyPrint can take multiple stylesheets.
    # If stylesheet is provided, we wrap it in a list.
    stylesheets = []
    if stylesheet:
        from weasyprint import CSS
        import io
        stylesheets.append(CSS(string=stylesheet))
    
    return HTML(string=html_content).write_pdf(stylesheets=stylesheets)
