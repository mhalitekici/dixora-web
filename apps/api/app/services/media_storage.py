from __future__ import annotations

import asyncio
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from typing import Protocol
from urllib.parse import urlsplit

from minio import Minio
from minio.error import S3Error
from starlette.concurrency import run_in_threadpool

from app.config import Settings


class MediaStorageError(Exception):
    """Raised when the backing object store is unavailable."""


class MediaObjectNotFound(MediaStorageError):
    """Raised when an object key does not exist."""


@dataclass(frozen=True, slots=True)
class StoredMediaObject:
    data: bytes
    content_type: str
    etag: str


class MediaStorage(Protocol):
    async def put_object(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get_object(self, key: str) -> StoredMediaObject: ...

    async def delete_object(self, key: str) -> None: ...


class InMemoryMediaStorage:
    def __init__(self) -> None:
        self._objects: dict[str, StoredMediaObject] = {}
        self._lock = asyncio.Lock()

    async def put_object(self, key: str, data: bytes, content_type: str) -> None:
        stored = StoredMediaObject(
            data=bytes(data),
            content_type=content_type,
            etag=sha256(data).hexdigest(),
        )
        async with self._lock:
            self._objects[key] = stored

    async def get_object(self, key: str) -> StoredMediaObject:
        async with self._lock:
            stored = self._objects.get(key)
        if stored is None:
            raise MediaObjectNotFound(key)
        return stored

    async def delete_object(self, key: str) -> None:
        async with self._lock:
            self._objects.pop(key, None)


class MinioMediaStorage:
    def __init__(self, settings: Settings) -> None:
        endpoint, secure = _minio_endpoint(settings.s3_endpoint)
        self._bucket = settings.s3_bucket
        self._client = Minio(
            endpoint,
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key.get_secret_value(),
            secure=secure,
            region=settings.s3_region,
        )

    async def put_object(self, key: str, data: bytes, content_type: str) -> None:
        try:
            await run_in_threadpool(
                self._client.put_object,
                self._bucket,
                key,
                BytesIO(data),
                len(data),
                content_type=content_type,
            )
        except Exception as exc:
            raise MediaStorageError("Unable to store media object") from exc

    async def get_object(self, key: str) -> StoredMediaObject:
        def read_object() -> StoredMediaObject:
            try:
                response = self._client.get_object(self._bucket, key)
            except S3Error as exc:
                if exc.code in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
                    raise MediaObjectNotFound(key) from exc
                raise MediaStorageError("Unable to read media object") from exc
            try:
                data = bytes(response.read())
                content_type = response.headers.get(
                    "content-type",
                    "application/octet-stream",
                )
                return StoredMediaObject(
                    data=data,
                    content_type=content_type,
                    etag=sha256(data).hexdigest(),
                )
            except Exception as exc:
                raise MediaStorageError("Unable to read media object") from exc
            finally:
                response.close()
                response.release_conn()

        return await run_in_threadpool(read_object)

    async def delete_object(self, key: str) -> None:
        try:
            await run_in_threadpool(
                self._client.remove_object,
                self._bucket,
                key,
            )
        except Exception as exc:
            raise MediaStorageError("Unable to delete media object") from exc


def create_media_storage(settings: Settings) -> MediaStorage:
    if settings.environment == "test":
        return InMemoryMediaStorage()
    return MinioMediaStorage(settings)


def _minio_endpoint(value: str) -> tuple[str, bool]:
    raw = value.strip()
    parsed = urlsplit(raw if "://" in raw else f"http://{raw}")
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("S3 endpoint must be an HTTP(S) origin without a path")
    return parsed.netloc, parsed.scheme == "https"
