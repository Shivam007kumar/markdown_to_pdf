from app.convert import convert

def test_heading_h1(): 
    assert "<h1>" in convert("# Hello")

def test_bold():        
    assert "<strong>" in convert("**bold**")

def test_code_block():  
    assert "<pre>" in convert("```python\nprint()\n```")

def test_table():       
    assert "<table>" in convert("| a | b |\n|---|---|\n| 1 | 2 |")

def test_blockquote():  
    assert "<blockquote>" in convert("> quote")
