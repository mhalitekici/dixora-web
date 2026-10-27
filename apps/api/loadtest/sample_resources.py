"""Sample Docker CPU/RAM and PostgreSQL connections from the validation stack."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def sample(project: str) -> dict:
    compose = [
        "docker",
        "compose",
        "-p",
        project,
        "-f",
        "infrastructure/docker-compose.validation.yml",
    ]

    def command(args):
        return subprocess.check_output(args, cwd=ROOT, text=True, timeout=20).strip()

    containers = command([*compose, "ps", "-q"]).splitlines()
    if not containers:
        raise RuntimeError("No validation containers running")
    usage = command(["docker", "stats", "--no-stream", "--format", "{{json .}}", *containers])
    connections = command(
        [
            *compose,
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            "dixora",
            "-d",
            "dixora_validation",
            "-Atc",
            "SELECT json_build_object('total',count(*),'active',"
            "count(*) FILTER (WHERE state='active')) FROM pg_stat_activity",
        ]
    )
    return {
        "at": datetime.now(UTC).isoformat(),
        "containers": [json.loads(row) for row in usage.splitlines()],
        "database_connections": json.loads(connections),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default="dixora-p0-validation")
    parser.add_argument("--seconds", type=int, default=3600)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if (
        not args.project.startswith("dixora-")
        or "validation" not in args.project
        or args.seconds < 1
    ):
        parser.error("Use an isolated Dixora validation project and a positive duration")
    until = time.monotonic() + args.seconds
    with args.output.open("w", encoding="utf-8") as stream:
        while time.monotonic() < until:
            try:
                record = sample(args.project)
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
                record = {"at": datetime.now(UTC).isoformat(), "sample_error": type(exc).__name__}
            stream.write(json.dumps(record) + "\n")
            stream.flush()
            time.sleep(min(10, max(0, until - time.monotonic())))
