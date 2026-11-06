from __future__ import annotations

import unittest
from unittest.mock import patch

from reload_tls import reload_certificate


class ReloadTlsTests(unittest.TestCase):
    def test_dry_run_never_calls_docker(self) -> None:
        def forbidden(*args: object) -> str:
            raise AssertionError("Dry run performed IO")
        self.assertIn("dry-run", reload_certificate("example.test", dry_run=True, command=forbidden, served=forbidden))

    def test_matching_certificate_is_a_noop(self) -> None:
        with patch("reload_tls.fingerprint", return_value="new"):
            commands: list[list[str]] = []
            reload_certificate("example.test", command=lambda args: commands.append(args) or "pem", served=lambda *_: "new")
            self.assertEqual(len(commands), 1)

    def test_reload_is_verified(self) -> None:
        with patch("reload_tls.fingerprint", return_value="new"):
            responses = iter(["old", "old", "new"])
            commands: list[list[str]] = []
            result = reload_certificate("example.test", command=lambda args: commands.append(args) or "pem", served=lambda *_: next(responses), pause=lambda _: None)
            self.assertEqual(result, "reloaded-and-verified")
            self.assertEqual(commands[1][-2:], ["nginx", "-t"])
            self.assertEqual(commands[2][-3:], ["nginx", "-s", "reload"])

    def test_invalid_config_never_reloads(self) -> None:
        commands: list[list[str]] = []
        def command(args: list[str]) -> str:
            commands.append(args)
            if args[-1] == "-t":
                raise RuntimeError("bad config")
            return "pem"
        with patch("reload_tls.fingerprint", return_value="new"), self.assertRaises(RuntimeError):
            reload_certificate("example.test", command=command, served=lambda *_: "old")
        self.assertFalse(any("reload" in args for args in commands))

    def test_stale_certificate_after_reload_fails(self) -> None:
        with patch("reload_tls.fingerprint", return_value="new"), self.assertRaisesRegex(RuntimeError, "old certificate"):
            reload_certificate("example.test", command=lambda _: "pem", served=lambda *_: "old", pause=lambda _: None)

    def test_invalid_domain_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            reload_certificate("../../private", dry_run=True)
