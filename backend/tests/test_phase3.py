from app.styles import get_base_styles, build_styles

def test_h1_color_injected():     
    assert "#2c3e50" in get_base_styles()

def test_code_bg_injected():      
    assert "#2d2d2d" in get_base_styles()

def test_fira_code_injected():    
    assert "Fira Code" in get_base_styles()

def test_custom_css_overrides():  
    css = build_styles(custom="h1 { color: red; }")
    assert "color: red" in css
