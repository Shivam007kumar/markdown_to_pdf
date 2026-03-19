import boto3
import os
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv()

def get_s3_client():
    return boto3.client(
        's3',
        aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
        aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
        region_name=os.getenv('AWS_REGION', 'ap-south-1')
    )

def upload_to_s3(pdf_bytes: bytes, file_name: str) -> bool:
    """
    Uploads PDF bytes to S3.
    """
    s3 = get_s3_client()
    bucket = os.getenv('S3_BUCKET_NAME')
    try:
        s3.put_object(
            Bucket=bucket,
            Key=file_name,
            Body=pdf_bytes,
            ContentType='application/pdf'
        )
        return True
    except ClientError as e:
        print(f"S3 Upload Error: {e}")
        return False

def get_presigned_url(file_name: str, expiration=3600) -> str:
    """
    Generates a presigned URL to share an S3 object.
    """
    s3 = get_s3_client()
    bucket = os.getenv('S3_BUCKET_NAME')
    try:
        response = s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': file_name},
            ExpiresIn=expiration
        )
        return response
    except ClientError as e:
        print(f"S3 Presigned URL Error: {e}")
        return None
