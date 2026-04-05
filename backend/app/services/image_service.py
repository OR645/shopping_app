import io
import logging
from fastapi import UploadFile, HTTPException

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


def _get_s3_client():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=f"http://{settings.minio_endpoint}",
        aws_access_key_id=settings.minio_access_key,
        aws_secret_access_key=settings.minio_secret_key,
        region_name="us-east-1",
    )


def _ensure_bucket():
    s3 = _get_s3_client()
    try:
        s3.head_bucket(Bucket=settings.minio_bucket)
    except Exception:
        s3.create_bucket(Bucket=settings.minio_bucket)
        # Make bucket public-read for image serving
        s3.put_bucket_policy(
            Bucket=settings.minio_bucket,
            Policy=f'{{"Version":"2012-10-17","Statement":[{{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::{settings.minio_bucket}/*"}}]}}',
        )


async def upload_catalog_image(item_id: str, file: UploadFile) -> str:
    """
    Accepts an uploaded image, creates a 400×400 WebP thumbnail,
    uploads to MinIO, returns the public URL.
    """
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status_code=400, detail="תמונה חייבת להיות JPEG, PNG, או WebP")

    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:  # 5MB limit
        raise HTTPException(status_code=400, detail="התמונה גדולה מדי (מקסימום 5MB)")

    try:
        from PIL import Image

        img = Image.open(io.BytesIO(contents))
        img = img.convert("RGB")

        # Crop to square
        w, h = img.size
        size = min(w, h)
        left = (w - size) // 2
        top = (h - size) // 2
        img = img.crop((left, top, left + size, top + size))

        # Resize to 400×400
        img = img.resize((400, 400), Image.LANCZOS)

        # Encode as WebP
        buffer = io.BytesIO()
        img.save(buffer, format="WEBP", quality=82, optimize=True)
        buffer.seek(0)

        _ensure_bucket()
        s3 = _get_s3_client()
        key = f"catalog/{item_id}/thumb.webp"
        s3.upload_fileobj(
            buffer,
            settings.minio_bucket,
            key,
            ExtraArgs={"ContentType": "image/webp", "CacheControl": "max-age=31536000"},
        )

        url = f"http://{settings.minio_endpoint}/{settings.minio_bucket}/{key}"
        logger.info(f"Uploaded image for catalog item {item_id}: {url}")
        return url

    except Exception as exc:
        logger.error(f"Image upload failed: {exc}")
        raise HTTPException(status_code=500, detail="שגיאה בהעלאת התמונה")
