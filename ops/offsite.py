"""Encrypted off-host backup copies using the host's restic executable."""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit


def validate_config(*, allow_local=False):
    repository = os.environ.get("RESTIC_REPOSITORY", "")
    if not repository:
        raise ValueError("Set RESTIC_REPOSITORY to an independent S3 or SFTP backup host")
    if not os.environ.get("RESTIC_PASSWORD_FILE"):
        raise ValueError("Set RESTIC_PASSWORD_FILE; keep a recovery copy outside this server")
    if not Path(os.environ["RESTIC_PASSWORD_FILE"]).is_file():
        raise ValueError("RESTIC_PASSWORD_FILE does not exist")
    if allow_local:
        return
    if repository.startswith("s3:https://"):
        host = urlsplit(repository[3:]).hostname
    elif repository.startswith("sftp://"):
        host = urlsplit(repository).hostname
    elif repository.startswith("sftp:"):
        host = repository[5:].split(":", 1)[0].rsplit("@", 1)[-1]
    else:
        raise ValueError("Offsite requires HTTPS S3 or SFTP; local repositories are refused")
    if not host or host.lower() in {"localhost", "minio", "host.docker.internal"}:
        raise ValueError("The backup repository must be on a separate host")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if address.is_loopback or address.is_unspecified or address.is_link_local:
            raise ValueError("The backup repository must be on a separate host")


def restic(*args, cwd=None):
    # Credentials stay in the process environment/password file, never argv.
    result = subprocess.run(
        [os.environ.get("RESTIC_BIN", "restic"), *args], cwd=cwd,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8",
    )
    if result.returncode:
        # Backend errors can contain signed URLs or credentials; inspect locally.
        raise RuntimeError(f"restic {args[0]} failed (exit {result.returncode}); check repository access")
    return result.stdout


def preflight(*, allow_local=False):
    validate_config(allow_local=allow_local)
    restic("cat", "config")


def upload(bundle, *, allow_local=False):
    from backup import verify

    verify(bundle)
    preflight(allow_local=allow_local)
    output = restic("backup", "--json", "--tag", "dixora", ".", cwd=bundle.resolve())
    summary = next((json.loads(line) for line in reversed(output.splitlines())
                    if json.loads(line).get("message_type") == "summary"), {})
    snapshot = summary.get("snapshot_id")
    if not snapshot:
        raise RuntimeError("restic did not return a completed snapshot")
    restic("check")
    return snapshot


def download(snapshot, directory, *, allow_local=False):
    from backup import verify

    if not re.fullmatch(r"[0-9a-f]{8,64}", snapshot):
        raise ValueError("Use an explicit snapshot ID from the backup receipt")
    if directory.exists():
        raise ValueError("Recovery directory already exists; choose a fresh directory")
    preflight(allow_local=allow_local)
    directory.mkdir(mode=0o700, parents=True)
    restic("restore", snapshot, "--verify", "--target", str(directory.resolve()))
    bundles = list(directory.rglob("manifest.json"))
    if len(bundles) != 1:
        raise ValueError("Expected exactly one backup bundle in the recovered snapshot")
    bundle = bundles[0].parent
    verify(bundle)
    return bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-local", action="store_true", help="Local recovery drills only")
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("init")
    actions.add_parser("check")
    actions.add_parser("snapshots")
    push = actions.add_parser("upload")
    push.add_argument("bundle", type=Path)
    pull = actions.add_parser("download")
    pull.add_argument("snapshot")
    pull.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    validate_config(allow_local=args.allow_local)
    if args.action == "init":
        restic("init")
        print("Encrypted repository initialized")
    elif args.action == "check":
        restic("check", "--read-data")
        print("Repository data verified")
    elif args.action == "snapshots":
        print(restic("snapshots", "--json", "--tag", "dixora"))
    elif args.action == "upload":
        print(json.dumps({"offsite_snapshot": upload(args.bundle, allow_local=args.allow_local)}))
    else:
        bundle = download(args.snapshot, args.directory, allow_local=args.allow_local)
        print(json.dumps({"recovered_bundle": str(bundle)}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as exc:
        raise SystemExit(str(exc)) from None
