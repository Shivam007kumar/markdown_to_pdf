from app.pdf import to_pdf

def test_returns_bytes():     
    assert isinstance(to_pdf("<h1>Hi</h1>"), bytes)

def test_pdf_header():        
    assert to_pdf("<p>x</p>")[:4] == b"%PDF"

def test_not_empty():         
    assert len(to_pdf("<h1>Hello</h1>")) > 1000

def test_no_crash_on_empty(): 
    assert to_pdf("<p></p>") is not None
