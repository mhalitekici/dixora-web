"""Runs inside the API image; credentials stay in its environment.

Archives application media (current object versions, content types and user
metadata), not MinIO server configuration or historical object versions.
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import tarfile
from pathlib import Path


def digest(stream):
    result = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        result.update(chunk)
    return result.hexdigest()


def inspect_archive(path):
    with tarfile.open(path, "r:") as archive:
        manifest = json.load(archive.extractfile("manifest.json"))
        if manifest.get("version") != 1:
            raise ValueError("Unsupported media archive version")
        expected = {"manifest.json"}
        keys = set()
        for index, item in enumerate(manifest["objects"]):
            member = f"objects/{index}"
            expected.add(member)
            if item["member"] != member or item["key"] in keys:
                raise ValueError("Invalid/duplicate object in media manifest")
            keys.add(item["key"])
            info = archive.getmember(member)
            if not info.isfile() or info.size != item["size"]:
                raise ValueError(f"Invalid media size: {member}")
            with archive.extractfile(info) as stream:
                if digest(stream) != item["sha256"]:
                    raise ValueError(f"Media checksum mismatch: {member}")
        members = archive.getmembers()
        if len(members) != len(expected) or {m.name for m in members} != expected:
            raise ValueError("Unexpected media archive entries")
        return manifest


def storage():
    from minio import Minio

    from app.config import Settings
    from app.services.media_storage import _minio_endpoint

    settings = Settings()
    endpoint, secure = _minio_endpoint(settings.s3_endpoint)
    return Minio(
        endpoint,
        access_key=settings.s3_access_key,
        secret_key=settings.s3_secret_key.get_secret_value(),
        secure=secure,
        region=settings.s3_region,
    ), settings.s3_bucket, settings.s3_region


def backup(path):
    import tempfile

    client, bucket, _ = storage()
    records = []
    with tarfile.open(path, "w:") as archive:
        for obj in client.list_objects(bucket, recursive=True):
            response = client.get_object(bucket, obj.object_name)
            try:
                # Spool large objects to disk rather than retaining the bucket in RAM.
                with tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024) as stream:
                    checksum = hashlib.sha256()
                    size = 0
                    for chunk in response.stream(1024 * 1024):
                        stream.write(chunk)
                        checksum.update(chunk)
                        size += len(chunk)
                    if size != int(response.headers["content-length"]):
                        raise ValueError("Truncated media response")
                    member = f"objects/{len(records)}"
                    info = tarfile.TarInfo(member)
                    info.size = size
                    stream.seek(0)
                    archive.addfile(info, stream)
                    records.append({
                        "key": obj.object_name,
                        "member": member,
                        "size": size,
                        "sha256": checksum.hexdigest(),
                        "content_type": response.headers.get("content-type", "application/octet-stream"),
                        "metadata": {
                            key: value for key, value in response.headers.items()
                            if key.lower().startswith("x-amz-meta-")
                        },
                    })
            finally:
                response.close()
                response.release_conn()
        manifest = {"version": 1, "bucket": bucket, "objects": records}
        data = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
        info = tarfile.TarInfo("manifest.json")
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
    inspect_archive(path)
    return {"bucket": bucket, "objects": len(records)}


def restore(path, target, check_only=False):
    manifest = inspect_archive(path)
    client, source, region = storage()
    if target == source:
        raise ValueError("Refusing to restore over the configured live media bucket")
    if client.bucket_exists(target):
        raise ValueError("Restore target bucket already exists; choose a fresh name")
    if check_only:
        return {"bucket": target, "ready": True}
    # make_bucket also fails if another restore created the bucket since preflight.
    client.make_bucket(target, location=region)
    # New buckets are private; no anonymous policy is installed.
    with tarfile.open(path, "r:") as archive:
        for item in manifest["objects"]:
            with archive.extractfile(item["member"]) as stream:
                client.put_object(
                    target, item["key"], stream, item["size"],
                    content_type=item["content_type"], metadata=item["metadata"],
                )
            response = client.get_object(target, item["key"])
            try:
                if digest(response) != item["sha256"]:
                    raise ValueError("Restored object checksum mismatch")
                if response.headers.get("content-type") != item["content_type"]:
                    raise ValueError("Restored object content type mismatch")
                for key, value in item["metadata"].items():
                    if response.headers.get(key) != value:
                        raise ValueError("Restored object metadata mismatch")
            finally:
                response.close()
                response.release_conn()
    return {"bucket": target, "objects_verified": len(manifest["objects"])}


if __name__ == "__main__":
    action, filename, *args = sys.argv[1:]
    if filename == "-":
        import shutil

        filename = "/tmp/dixora-media.tar"
        with open(filename, "wb") as output:
            shutil.copyfileobj(sys.stdin.buffer, output)
    if action == "backup":
        result = backup(Path(filename))
    else:
        result = restore(Path(filename), args[0], check_only=action == "preflight")
    print(json.dumps(result))
