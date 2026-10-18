"""Non-customer media fixtures for the disposable backup/restore drill only."""
import io

from minio import Minio

from app.config import Settings
from app.services.media_storage import _minio_endpoint

settings = Settings()
assert settings.s3_bucket == "dixora-validation-media", "Only run in the validation stack"
endpoint, secure = _minio_endpoint(settings.s3_endpoint)
client = Minio(endpoint, access_key=settings.s3_access_key,
               secret_key=settings.s3_secret_key.get_secret_value(), secure=secure)
if not client.bucket_exists(settings.s3_bucket):
    client.make_bucket(settings.s3_bucket)
for key, data, content_type in (
    ("validation/products/ürün resmi.png", b"validation image bytes", "image/png"),
    ("validation/empty.bin", b"", "application/octet-stream"),
):
    client.put_object(settings.s3_bucket, key, io.BytesIO(data), len(data),
                      content_type=content_type, metadata={"validation": "true"})
print("Created 2 validation objects (Unicode key, empty object, metadata and content types)")
