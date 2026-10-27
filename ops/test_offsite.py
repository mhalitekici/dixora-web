"""Offsite configuration and recovery safeguards, without external credentials."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import offsite


class OffsiteTests(unittest.TestCase):
    def test_scheduler_refuses_local_and_loopback_repositories(self):
        with tempfile.TemporaryDirectory() as temp:
            password = Path(temp) / "password"
            password.write_text("test-only")
            for repository in (temp, "s3:http://remote/bucket", "s3:https://localhost/bucket",
                               "sftp:user@127.0.0.1:/backup", "sftp://user@[::1]/backup"):
                with self.subTest(repository=repository), patch.dict(os.environ, {
                    "RESTIC_REPOSITORY": repository, "RESTIC_PASSWORD_FILE": str(password),
                }):
                    with self.assertRaises(ValueError):
                        offsite.validate_config()

    def test_remote_s3_and_sftp_are_accepted(self):
        with tempfile.NamedTemporaryFile() as password:
            for repository in ("s3:https://backup.example.test/bucket", "sftp:user@backup:/data",
                               "sftp://user@10.0.2.3:2222//backup"):
                with self.subTest(repository=repository), patch.dict(os.environ, {
                    "RESTIC_REPOSITORY": repository, "RESTIC_PASSWORD_FILE": password.name,
                }):
                    offsite.validate_config()

    def test_restore_refuses_existing_directory_before_accessing_repository(self):
        with tempfile.TemporaryDirectory() as temp, patch("offsite.restic") as command:
            with self.assertRaises(ValueError):
                offsite.download("a" * 64, Path(temp))
            command.assert_not_called()

    def test_restore_requires_explicit_snapshot(self):
        with patch("offsite.restic") as command:
            with self.assertRaises(ValueError):
                offsite.download("latest", Path("unused"))
            command.assert_not_called()

    def test_upload_failure_preserves_local_bundle(self):
        with tempfile.TemporaryDirectory() as temp, \
                patch("backup.verify"), patch("offsite.preflight"), \
                patch("offsite.restic", side_effect=RuntimeError("unreachable")):
            bundle = Path(temp)
            with self.assertRaises(RuntimeError):
                offsite.upload(bundle)
            self.assertTrue(bundle.exists())


if __name__ == "__main__":
    unittest.main()
