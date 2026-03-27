import boto3
import os
import logging
from botocore.exceptions import ClientError
from botocore.config import Config
import threading

# Fix: Use a module-level singleton for connection pooling
# Fix: Add retry logic via botocore Config
_s3_client = None
_s3_lock = threading.Lock()

def get_s3_client():
    global _s3_client
    if _s3_client is None:
        with _s3_lock:
            # Fix: Thread-safe singleton creation to prevent concurrent overrides
            if _s3_client is None:
                _s3_client = boto3.client(
                    's3',
                    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
                    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
                    region_name=os.getenv('AWS_REGION', 'ap-south-1'),
                    config=Config(retries={'max_attempts': 3})
                )
    return _s3_client

def upload_to_s3(pdf_bytes: bytes, file_name: str) -> bool:
    """
    Uploads PDF bytes to S3.
    """
    s3 = get_s3_client()
    bucket = os.getenv('S3_BUCKET_NAME')
    if not bucket:
        logging.error("S3_BUCKET_NAME environment variable is not set!")
        return False
        
    try:
        s3.put_object(
            Bucket=bucket,
            Key=file_name,
            Body=pdf_bytes,
            ContentType='application/pdf'
        )
        return True
    except ClientError as e:
        # Fix: Use structured logging instead of print
        logging.error(f"S3 Upload Error: {e}")
        return False

# Fix: Cache at module level
_expiration_cache = None

def get_presigned_url(file_name: str) -> str:
    """
    Generates a presigned URL to share an S3 object.
    """
    global _expiration_cache
    if _expiration_cache is None:
        _expiration_cache = int(os.getenv('PRESIGNED_URL_EXPIRES', 3600))
        
    s3 = get_s3_client()
    bucket = os.getenv('S3_BUCKET_NAME')
    if not bucket:
        return None
        
    try:
        response = s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': file_name},
            ExpiresIn=_expiration_cache
        )
        return response
    except ClientError as e:
        # Fix: Use structured logging
        logging.error(f"S3 Presigned URL Error: {e}")
        return None
