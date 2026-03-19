from app.convert import convert

def test_mermaid_replaced_with_img():
    md = "```mermaid\ngraph TD; A-->B\n```"
    html = convert(md)
    assert "<img" in html and "mermaid.ink" in html

def test_mermaid_block_removed():
    assert "```mermaid" not in convert("```mermaid\ngraph TD; A-->B\n```")
