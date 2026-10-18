"""Integrity and destination safety checks; no Docker daemon is needed."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import backup
from media_snapshot import inspect_archive, restore


def archive(path, *, checksum=None, key="tenant/products/image.png", extra=False):
    data = b"test image bytes"
    manifest = {"version": 1, "bucket": "live-media", "objects": [{
        "key": key, "member": "objects/0", "size": len(data),
        "sha256": checksum or hashlib.sha256(data).hexdigest(),
        "content_type": "image/png", "metadata": {},
    }]}
    with tarfile.open(path, "w:") as output:
        for name, contents in [("objects/0", data), ("manifest.json", json.dumps(manifest).encode())]:
            info = tarfile.TarInfo(name)
            info.size = len(contents)
            output.addfile(info, io.BytesIO(contents))
        if extra:
            output.addfile(tarfile.TarInfo("../../outside"), io.BytesIO())


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bundle = Path(self.temp.name) / "bundle"
        self.bundle.mkdir()
        (self.bundle / "database.dump").write_bytes(b"PGDMP test archive")
        archive(self.bundle / "media.tar")
        self.manifest = {
            "version": 1, "source_database": "live_db", "source_bucket": "live-media", "objects": 1,
            "files": {name: {"bytes": (self.bundle / name).stat().st_size,
                             "sha256": backup.sha256(self.bundle / name)}
                      for name in ("database.dump", "media.tar")},
        }
        self.write_manifest()

    def write_manifest(self):
        (self.bundle / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def test_bundle_and_each_object_are_verified(self):
        self.assertEqual(backup.verify(self.bundle)["objects"], 1)

    def test_corrupted_database_is_rejected_before_any_docker_call(self):
        (self.bundle / "database.dump").write_bytes(b"PGDMP corrupt data")
        with patch.object(backup, "compose") as compose:
            with self.assertRaisesRegex(ValueError, "checksum"):
                backup.restore(argparse.Namespace(bundle=self.bundle, database="scratch", bucket="scratch"))
            compose.assert_not_called()

    def test_inner_object_checksum_is_verified(self):
        archive(self.bundle / "media.tar", checksum="0" * 64)
        with self.assertRaisesRegex(ValueError, "checksum"):
            inspect_archive(self.bundle / "media.tar")

    def test_unexpected_tar_members_are_rejected_without_extracting(self):
        archive(self.bundle / "media.tar", extra=True)
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            inspect_archive(self.bundle / "media.tar")

    def test_manifest_cannot_select_arbitrary_files(self):
        self.manifest["files"]["../secret"] = self.manifest["files"].pop("database.dump")
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "manifest"):
            backup.verify(self.bundle)

    def test_live_and_existing_database_are_refused_before_media_or_writes(self):
        for target in ("live_db", "postgres", "template1", "other_existing"):
            with self.subTest(target=target), patch.object(backup, "pg", return_value="live_db\n"), \
                    patch.object(backup, "pg_sql", return_value="1") as sql, \
                    patch.object(backup, "media") as media:
                with self.assertRaises(ValueError):
                    backup.restore(argparse.Namespace(bundle=self.bundle, database=target, bucket="fresh"))
                media.assert_not_called()
                self.assertTrue(all("SELECT" in call.args[1] for call in sql.call_args_list))

    def test_sql_identifiers_are_validated(self):
        for target in ("x; DROP DATABASE live_db", "UPPERCASE", "--dbname=live_db"):
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, "identifier"):
                backup.restore(argparse.Namespace(bundle=self.bundle, database=target, bucket="fresh"))

    def test_live_and_existing_buckets_are_refused_before_writes(self):
        client = Mock()
        client.bucket_exists.return_value = True
        for target in ("live-media", "existing-scratch"):
            with self.subTest(target=target), \
                    patch("media_snapshot.storage", return_value=(client, "live-media", "us-east-1")):
                with self.assertRaises(ValueError):
                    restore(self.bundle / "media.tar", target)
        client.make_bucket.assert_not_called()
        client.put_object.assert_not_called()

    def test_empty_bucket_archive_is_valid(self):
        path = self.bundle / "empty.tar"
        data = json.dumps({"version": 1, "bucket": "empty", "objects": []}).encode()
        with tarfile.open(path, "w:") as output:
            info = tarfile.TarInfo("manifest.json")
            info.size = len(data)
            output.addfile(info, io.BytesIO(data))
        self.assertEqual(inspect_archive(path)["objects"], [])

    def test_retention_only_removes_old_complete_bundles(self):
        root = Path(self.temp.name)
        old = root / "dixora-20200101T000000Z-0123abcd"
        old.mkdir()
        (old / "manifest.json").write_text("{}")
        os.utime(old, (0, 0))
        incomplete = root / "dixora-20200101T000000Z-1234abcd"
        incomplete.mkdir()
        os.utime(incomplete, (0, 0))
        backup.prune(root, 14)
        self.assertFalse(old.exists())
        self.assertTrue(incomplete.exists())
        self.assertTrue(self.bundle.exists())


if __name__ == "__main__":
    unittest.main()
