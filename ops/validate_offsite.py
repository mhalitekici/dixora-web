"""Encrypted transfer/recovery drill; a local test repo is NOT off-host protection."""
import argparse
import json
import os
import tempfile
from pathlib import Path

import offsite


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    if args.directory.exists():
        parser.error("Use a fresh drill directory")
    args.directory.mkdir(mode=0o700, parents=True)
    with tempfile.TemporaryDirectory(prefix="dixora-restic-key-") as temp:
        password = Path(temp) / "password"
        password.write_text(os.urandom(32).hex(), encoding="utf-8")
        os.environ["RESTIC_PASSWORD_FILE"] = str(password)
        os.environ["RESTIC_REPOSITORY"] = str((args.directory / "repository").resolve())
        offsite.restic("init")
        snapshot = offsite.upload(args.bundle, allow_local=True)
        bundle = offsite.download(snapshot, args.directory / "recovered", allow_local=True)
        offsite.restic("check", "--read-data")
    print(json.dumps({"snapshot": snapshot, "recovered_bundle": str(bundle)}))


if __name__ == "__main__":
    main()
