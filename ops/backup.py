"""PostgreSQL + MinIO backup bundles. Host requires Python 3.11+ and Compose v2."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from media_snapshot import inspect_archive
import offsite

ROOT = Path(__file__).resolve().parents[1]
PG = os.environ.get("POSTGRES_SERVICE", "postgres")
API = os.environ.get("API_SERVICE", "api")
MEDIA_SOURCE = (ROOT / "ops/media_snapshot.py").read_text(encoding="utf-8")


def command(*args, quiet=False, stdin=None):
    return subprocess.run(
        list(args), cwd=ROOT, check=True, encoding="utf-8",
        stdout=subprocess.PIPE if quiet else None,
        stdin=stdin if stdin is not None else subprocess.DEVNULL,
    ).stdout


def compose(*args, quiet=False, stdin=None):
    return command("docker", "compose", *args, quiet=quiet, stdin=stdin)


def pg(*args, quiet=False):
    return compose("exec", "-T", PG, *args, quiet=quiet)


def pg_sql(database, sql):
    return pg(
        "sh", "-c", 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -Atc "$2"',
        "backup", database, sql, quiet=True,
    ).strip()


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def row_counts(database):
    # Compare every application table during a quiesced restore drill.
    sql = """
        SELECT coalesce(json_object_agg(table_name, n), '{}'::json)
        FROM (
          SELECT table_name,
                 ((xpath('/row/n/text()', query_to_xml(
                   format('SELECT count(*) AS n FROM %I.%I', table_schema, table_name),
                   false, true, '')))[1]::text)::bigint AS n
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ) counts
    """
    return json.loads(pg_sql(database, sql))


def verify(bundle):
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") != 1 or set(manifest["files"]) != {"database.dump", "media.tar"}:
        raise ValueError("Invalid backup manifest")
    for name, entry in manifest["files"].items():
        path = bundle / name
        if path.is_symlink() or path.stat().st_size != entry["bytes"] or sha256(path) != entry["sha256"]:
            raise ValueError(f"Backup checksum mismatch: {name}")
    media = inspect_archive(bundle / "media.tar")
    if media["bucket"] != manifest["source_bucket"] or len(media["objects"]) != manifest["objects"]:
        raise ValueError("Media manifest does not match backup manifest")
    return manifest


def media(action, local_path, target=None):
    # A one-off API container also works while application writers are stopped.
    # Credentials come from Compose; they never appear in command arguments.
    name = f"dixora-backup-{uuid.uuid4().hex}"
    remote = "/tmp/dixora-media.tar"
    try:
        args = ("run", "--no-deps", "-T", "--name", name, "--entrypoint", "python", API,
                "-c", MEDIA_SOURCE, action)
        if action == "backup":
            output = compose(*args, remote, quiet=True)
        else:
            with local_path.open("rb") as stream:
                output = compose(*args, "-", target, quiet=True, stdin=stream)
        result = json.loads(output.splitlines()[-1])
        if action == "backup":
            command("docker", "cp", f"{name}:{remote}", str(local_path.resolve()), quiet=True)
        return result
    finally:
        # Only the uniquely named helper container belongs to this invocation.
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@contextmanager
def quiesced(enabled):
    running = []
    if enabled:
        services = compose("ps", "--status", "running", "--services", quiet=True).splitlines()
        running = [s for s in ("web", API) if s in services]
    try:
        if running:
            compose("stop", *running)
        yield
    finally:
        if running:
            compose("start", *reversed(running))


def prune(directory, days):
    directory = directory.resolve()
    for candidate in directory.iterdir():
        # Limit deletion to complete bundles directly under the explicit backup root.
        if (re.fullmatch(r"dixora-\d{8}T\d{6}Z-[a-f0-9]{8}", candidate.name)
                and not candidate.is_symlink() and candidate.is_dir()
                and candidate.resolve().parent == directory
                and (candidate / "manifest.json").is_file()
                and candidate.stat().st_mtime < time.time() - days * 86400):
            shutil.rmtree(candidate)


def backup(args):
    if args.offsite:
        # Fail before stopping writers if the encrypted remote is unavailable.
        offsite.preflight()
    directory = args.directory.resolve()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = directory / ".backup.lock"
    # An abandoned lock requires operator investigation, not automatic lock stealing.
    with lock.open("x") as stream:
        stream.write(str(os.getpid()))
    remote = f"/tmp/dixora-{uuid.uuid4().hex}.dump"
    try:
        with tempfile.TemporaryDirectory(prefix=".partial-", dir=directory) as scratch:
            bundle = Path(scratch) / "bundle"
            bundle.mkdir(mode=0o700)
            with quiesced(args.quiesce):
                source_db = pg("printenv", "POSTGRES_DB", quiet=True).strip()
                pg("sh", "-c", 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" '
                   '--format=custom --no-owner --no-acl -f "$1"', "backup", remote)
                pg("pg_restore", "--list", remote, quiet=True)
                compose("cp", f"{PG}:{remote}", str(bundle / "database.dump"), quiet=True)
                summary = media("backup", bundle / "media.tar")
                counts = row_counts(source_db) if args.quiesce else None
            manifest = {
                "version": 1, "created_at": datetime.now(UTC).isoformat(),
                "source_database": source_db, "source_bucket": summary["bucket"],
                "objects": summary["objects"], "writers_quiesced": args.quiesce,
                "database_counts": counts,
                "files": {name: {"bytes": (bundle / name).stat().st_size,
                                 "sha256": sha256(bundle / name)}
                          for name in ("database.dump", "media.tar")},
            }
            (bundle / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
            verify(bundle)
            name = f"dixora-{datetime.now(UTC):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}"
            destination = directory / name
            bundle.rename(destination)
        snapshot = offsite.upload(destination) if args.offsite else None
        if snapshot:
            (destination / "offsite.json").write_text(
                json.dumps({"snapshot_id": snapshot}) + "\n", encoding="utf-8",
            )
        # An offsite failure leaves the local bundle intact and skips retention.
        prune(directory, args.retention_days)
        receipt = directory / ".last-success.tmp"
        receipt.write_text(json.dumps({
            "completed_at": datetime.now(UTC).isoformat(),
            "writers_quiesced": args.quiesce, "offsite_verified": bool(snapshot),
        }) + "\n", encoding="utf-8")
        receipt.replace(directory / "last-success.json")
        print(json.dumps({"backup": str(destination), "objects": summary["objects"],
                          "writers_quiesced": args.quiesce, "offsite_snapshot": snapshot}))
    finally:
        try:
            pg("rm", "-f", remote)
        finally:
            lock.unlink(missing_ok=True)


def restore(args):
    manifest = verify(args.bundle)
    # Never drop databases or overwrite buckets, even with a misleading target name.
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", args.database):
        raise ValueError("Target database must be a simple lowercase SQL identifier")
    live_db = pg("printenv", "POSTGRES_DB", quiet=True).strip()
    if args.database in {live_db, manifest["source_database"], "postgres", "template0", "template1"}:
        raise ValueError("Refusing to restore over a source/system database")
    if pg_sql("postgres", f"SELECT 1 FROM pg_database WHERE datname='{args.database}'"):
        raise ValueError("Restore target database already exists; choose a fresh name")
    media("preflight", args.bundle / "media.tar", args.bucket)
    remote = f"/tmp/dixora-restore-{uuid.uuid4().hex}.dump"
    try:
        compose("cp", str((args.bundle / "database.dump").resolve()), f"{PG}:{remote}", quiet=True)
        pg("pg_restore", "--list", remote, quiet=True)
        pg_sql("postgres", f'CREATE DATABASE "{args.database}"')
        pg("sh", "-c", 'exec pg_restore -U "$POSTGRES_USER" -d "$1" '
           '--single-transaction --exit-on-error --no-owner --no-acl "$2"',
           "restore", args.database, remote)
        summary = media("restore", args.bundle / "media.tar", args.bucket)
        counts = row_counts(args.database)
        if manifest.get("database_counts") is not None and counts != manifest["database_counts"]:
            raise ValueError("Restored database table counts differ from the backup")
        print(json.dumps({"restored_database": args.database, "tables_verified": len(counts),
                          "database_counts": counts,
                          **summary}))
    finally:
        pg("rm", "-f", remote)


def main():
    def terminate(signum, _frame):
        # Let context-manager/finally cleanup restart any quiesced services.
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, terminate)
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    create = actions.add_parser("create")
    create.add_argument("--directory", type=Path, default=Path(os.environ.get("BACKUP_DIR", ROOT / "backups")))
    create.add_argument("--retention-days", type=int, default=int(os.environ.get("RETENTION_DAYS", "14")))
    create.add_argument("--quiesce", action="store_true", help="Stop running web/API writers and restart them afterwards")
    create.add_argument("--offsite", action="store_true", help="Require a verified encrypted restic copy before pruning")
    check = actions.add_parser("verify")
    check.add_argument("bundle", type=Path)
    recover = actions.add_parser("restore")
    recover.add_argument("bundle", type=Path)
    recover.add_argument("--database", required=True)
    recover.add_argument("--bucket", required=True)
    args = parser.parse_args()
    if args.action == "create":
        if args.retention_days < 1:
            parser.error("retention-days must be at least 1")
        backup(args)
    elif args.action == "verify":
        result = verify(args.bundle)
        print(json.dumps({"verified": str(args.bundle), "objects": result["objects"]}))
    else:
        restore(args)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Backup operation failed: {exc}", file=sys.stderr)
        sys.exit(1)
