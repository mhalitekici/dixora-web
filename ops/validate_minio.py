"""Boot the production MinIO build and bucket initializer on disposable storage."""
import json
import secrets
import subprocess
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix="dixora-minio-") as temp:
        directory = Path(temp)
        env = directory / "production.env"
        template = (ROOT / ".env.production.example").read_text(encoding="utf-8")
        template = template.replace("<GENERATE>", secrets.token_hex(32))
        template += f"\nDIXORA_ENV_FILE={env.as_posix()}\n"
        env.write_text(template, encoding="utf-8")
        config = json.loads(subprocess.check_output([
            "docker", "compose", "-f", str(ROOT / "docker-compose.prod.yml"),
            "--env-file", str(env), "config", "--format", "json",
        ], cwd=ROOT))
        services = {name: config["services"][name] for name in ("minio", "minio-init")}
        for service in services.values():
            service.pop("networks", None)
        services["minio"].pop("volumes", None)
        services["minio"]["tmpfs"] = ["/data"]
        compose_file = directory / "compose.json"
        compose_file.write_text(json.dumps({"services": services}), encoding="utf-8")
        command = ["docker", "compose", "-p", f"dixora-minio-check-{uuid.uuid4().hex[:8]}",
                   "-f", str(compose_file)]
        try:
            subprocess.run([*command, "build", "minio", "minio-init"], check=True)
            subprocess.run([*command, "up", "-d", "--wait", "minio"], check=True)
            for _ in range(2):
                subprocess.run([*command, "run", "--rm", "--no-deps", "minio-init"], check=True)
            script = '''
                mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
                mc anonymous get "local/$S3_BUCKET" | grep -q private
                printf 'source-build-check' | mc pipe "local/$S3_BUCKET/smoke-check" >/dev/null
                test "$(mc cat "local/$S3_BUCKET/smoke-check")" = source-build-check
            '''
            subprocess.run([*command, "run", "--rm", "--no-deps", "--entrypoint", "/bin/sh",
                            "minio-init", "-ec", script], check=True)
            print("Production MinIO source build, health, private bucket, repeat init and object I/O passed")
        finally:
            subprocess.run([*command, "down", "--volumes"], check=True)


if __name__ == "__main__":
    main()
