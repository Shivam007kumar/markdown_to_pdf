from weasyprint import HTML
import ssl
import os

# Fix: Guarantee proper SSL resolution on macOS and production environments
# using certifi's bundled CA certificates securely instead of an insecure bypass.
import certifi
ssl_context = ssl.create_default_context(cafile=certifi.where())
ssl._create_default_https_context = lambda: ssl_context

from weasyprint import default_url_fetcher
from urllib.parse import urlparse
import logging

def safe_url_fetcher(url, timeout=10, **kwargs):
    parsed = urlparse(url)
    allowlist = ['kroki.io', 'mermaid.ink', 'latex.codecogs.com', 'fonts.googleapis.com', 'fonts.gstatic.com']
    
    # Fix: Prevent absolute file:// protocol SSRF vulnerabilities reading /etc/passwd
    if parsed.scheme not in ['http', 'https', 'data']:
        logging.warning(f"SSRF Protection blocked forbidden scheme: {parsed.scheme} for {url}")
        return dict(string=b"", mime_type="image/png")
        
    if parsed.hostname and parsed.hostname not in allowlist:
        logging.warning(f"SSRF Protection blocked WeasyPrint external fetch: {parsed.hostname}")
        return dict(string=b"", mime_type="image/png")
        
    return default_url_fetcher(url, timeout=timeout, **kwargs)

def to_pdf(html_content: str, stylesheet: str = None) -> bytes:
    """
    Convert HTML content to PDF using WeasyPrint.
    Accepts an optional CSS string.
    """
    stylesheets = []
    if stylesheet:
        from weasyprint import CSS
        stylesheets.append(CSS(string=stylesheet))
    
    return HTML(string=html_content, url_fetcher=safe_url_fetcher).write_pdf(stylesheets=stylesheets)
