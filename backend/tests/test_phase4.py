```python
from app.convert import convert

def test_inline_math():
    html = convert("Here is $E=mc^2$")
    assert 'latex.codecogs.com/svg.image' in html
    assert 'class="katex"' in html

def test_block_math():
    html = convert("$$\\alpha + \\beta$$")
    assert '<div class="katex-display"' in html
    assert 'latex.codecogs.com/svg.image' in html

def test_no_raw_latex(): 
    assert "$$" not in convert("$$x=1$$")
```
