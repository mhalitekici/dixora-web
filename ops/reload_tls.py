"""Load renewed certificates and verify the certificate served by local Nginx.

Run beside the production Compose file using the existing deployment env file.
Never mounts the Docker socket in the Certbot container. Failures reach systemd
OnFailure; the existing certificate is retained when nginx -t fails.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import socket
import ssl
import subprocess
import time
from collections.abc import Callable


def run(arguments: list[str]) -> str:
    return subprocess.run(arguments, check=True, capture_output=True, text=True, timeout=30).stdout


def fingerprint(pem: str) -> str:
    leaf = pem.split("-----END CERTIFICATE-----", 1)[0] + "-----END CERTIFICATE-----\n"
    return hashlib.sha256(ssl.PEM_cert_to_DER_cert(leaf)).hexdigest()


def served_fingerprint(domain: str, port: int) -> str:
    # Connection is always loopback; SNI selects the configured server. The
    # comparison with the trusted mounted leaf proves which cert was loaded,
    # including during the initial self-signed acceptance drill.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    with socket.create_connection(("127.0.0.1", port), timeout=5) as connection:
        with context.wrap_socket(connection, server_hostname=domain) as tls:
            certificate = tls.getpeercert(binary_form=True)
            if certificate is None:
                raise RuntimeError("Nginx did not serve a certificate")
            return hashlib.sha256(certificate).hexdigest()


def reload_certificate(
    domain: str, *, port: int = 443, dry_run: bool = False,
    command: Callable[[list[str]], str] = run,
    served: Callable[[str, int], str] = served_fingerprint,
    pause: Callable[[float], None] = time.sleep,
) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?", domain):
        raise ValueError("Invalid certificate domain")
    prefix = ["docker", "compose", "-f", "docker-compose.prod.yml", "exec", "-T", "proxy"]
    if dry_run:
        return "dry-run: compare mounted and served certificates; nginx -t; reload; verify"
    expected = fingerprint(command(prefix + ["cat", f"/etc/letsencrypt/live/{domain}/fullchain.pem"]))
    if served(domain, port) == expected:
        return "unchanged"
    command(prefix + ["nginx", "-t"])
    command(prefix + ["nginx", "-s", "reload"])
    for attempt in range(10):
        if served(domain, port) == expected:
            return "reloaded-and-verified"
        if attempt < 9:
            pause(1)
    raise RuntimeError("Nginx still serves the old certificate after reload")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--port", type=int, default=443)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps({"status": reload_certificate(args.domain, port=args.port, dry_run=args.dry_run)}))
