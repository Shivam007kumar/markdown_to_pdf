import logging
import asyncio
import uuid
import os
from dotenv import load_dotenv

# Fix: Initialize Dotenv perfectly once at startup
load_dotenv()

# Fix: Configure default production logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.convert import convert
from app.pdf import to_pdf
from app.styles import build_styles
from app.s3 import upload_to_s3, get_presigned_url


app = FastAPI()

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Fix: Dropped allow_credentials=True when using wildcard origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ExportRequest(BaseModel):
    # Fix: Added strict length validation to prevent massive payloads from choking WeasyPrint
    markdown: str = Field(..., max_length=1_000_000)
    custom_css: str = Field("", max_length=100_000)

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/export")
@limiter.limit("10/minute")
async def export_pdf(request: Request, payload: ExportRequest):
    try:
        # 1. Convert Markdown to HTML
        html_body = convert(payload.markdown)
        
        # 2. Build full CSS (base + custom)
        full_css = build_styles(payload.custom_css)
        
        # 3. Convert to PDF bytes inside a threadpool with a strict timeout
        try:
            pdf_bytes = await asyncio.wait_for(
                asyncio.to_thread(to_pdf, html_body, stylesheet=full_css), 
                timeout=300.0  # Increased to 5 minutes to accommodate large files
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="PDF generation timed out while fetching external resources.")
            
        if len(pdf_bytes) > 20_000_000: # 20MB generated limit
            raise HTTPException(status_code=400, detail="Generated document exceeds the 20MB internal limit.")
        
        # 4. Generate unique filename and upload to S3
        file_id = str(uuid.uuid4())
        file_name = f"exports/{file_id}.pdf"
        
        success = await asyncio.to_thread(upload_to_s3, pdf_bytes, file_name)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to upload to object storage.")
        
        # 5. Generate presigned URL
        url = await asyncio.to_thread(get_presigned_url, file_name)
        if not url:
            raise HTTPException(status_code=500, detail="Failed to generate download link.")
            
        return JSONResponse(content={"url": url})
        
    except HTTPException:
        raise
    except Exception as e:
        # Fix: Obscure internal error tracebacks in production output
        logging.error(f"Internal generation error: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred while processing the PDF.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
