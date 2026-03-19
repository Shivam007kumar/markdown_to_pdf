from app.convert import convert

def test_inline_math():  
    assert "katex" in convert("$x^2$")

def test_block_math():   
    assert "katex-display" in convert("$$\\int_0^1$$")

def test_no_raw_latex(): 
    assert "$$" not in convert("$$x=1$$")
