import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from monitor import backup_alerts


class MonitorTests(unittest.TestCase):
    def test_missing_or_invalid_receipts_cannot_look_like_a_successful_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "receipt.json"
            self.assertTrue(backup_alerts(path, now=datetime.now(UTC)))
            path.write_text("not json")
            self.assertTrue(backup_alerts(path, now=datetime.now(UTC)))

    def test_stale_non_quiesced_and_local_only_backups_are_actionable(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "receipt.json"
            now = datetime.now(UTC)
            path.write_text(
                json.dumps(
                    {
                        "completed_at": (now - timedelta(hours=27)).isoformat(),
                        "offsite_verified": False,
                        "writers_quiesced": False,
                    }
                )
            )
            self.assertEqual(
                backup_alerts(path, now=now),
                [
                    "backup_stale",
                    "backup_offsite_unverified",
                    "backup_consistency_unverified",
                ],
            )
            path.write_text(
                json.dumps(
                    {
                        "completed_at": now.isoformat(),
                        "offsite_verified": True,
                        "writers_quiesced": True,
                    }
                )
            )
            self.assertEqual(backup_alerts(path, now=now), [])


if __name__ == "__main__":
    unittest.main()
