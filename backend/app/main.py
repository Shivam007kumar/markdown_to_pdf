import sys
import os
# Allow executing directly without PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from app.convert import convert
from app.pdf import to_pdf
from app.styles import build_styles
import os

app = FastAPI()

class ExportRequest(BaseModel):
    markdown: str
    custom_css: str = ""

from app.s3 import upload_to_s3, get_presigned_url
import uuid
from fastapi.responses import JSONResponse

@app.post("/export")
async def export_pdf(request: ExportRequest):
    try:
        # 1. Convert Markdown to HTML
        html_body = convert(request.markdown)
        
        # 2. Build full CSS (base + custom)
        full_css = build_styles(request.custom_css)
        
        # 3. Convert to PDF bytes
        pdf_bytes = to_pdf(html_body, stylesheet=full_css)
        
        # 4. Generate unique filename and upload to S3
        file_id = str(uuid.uuid4())
        file_name = f"exports/{file_id}.pdf"
        
        success = upload_to_s3(pdf_bytes, file_name)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to upload to S3")
        
        # 5. Generate presigned URL
        url = get_presigned_url(file_name)
        if not url:
            raise HTTPException(status_code=500, detail="Failed to generate presigned URL")
            
        return JSONResponse(content={"url": url})
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
