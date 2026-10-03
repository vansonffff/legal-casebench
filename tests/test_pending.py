"""pending.py update-status：面板待办状态写回的唯一 Core 入口。"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CASE_SCRIPTS = REPO / "skills" / "legal-case-bench" / "common" / "scripts"
sys.path.insert(0, str(CASE_SCRIPTS))

from state_update import snapshot  # noqa: E402


def run(script: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(CASE_SCRIPTS / script), *args],
        text=True,
        capture_output=True,
        check=False,
    )


class PendingFixture(unittest.TestCase):
    """每个测试都从 `matter.py init` 建出的真实 Matter 开始，并预置两条待办：
    一条规范编号（TASK-0001），一条存量展示编号（P-001，中文自由值状态）。
    """

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "workspace"
        created = run("matter.py", "init", "--root", str(self.root), "--name", "待办案件", "--actor", "dsh")
        self.assertEqual(created.returncode, 0, created.stderr)
        self.case = self.root / "待办案件"
        self.state_path = self.case / "_case_state.json"
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        state["pending_items"] = [
            {"item_id": "TASK-0001", "title": "规范待办", "issue_ref": "", "status": "open"},
            {"id": "P-001", "title": "存量待办", "status": "待处理"},
        ]
        self.state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def state(self) -> dict:
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def update(self, item_id: str, status: str) -> subprocess.CompletedProcess:
        return run("pending.py", "update-status", "--case-dir", str(self.case),
                   "--item-id", item_id, "--status", status, "--actor", "dsh")


class PendingUpdateStatusTests(PendingFixture):
    def test_complete_canonical_item(self) -> None:
        result = self.update("TASK-0001", "completed")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "updated")
        self.assertEqual(payload["previous_status"], "open")
        item = self.state()["pending_items"][0]
        self.assertEqual(item["status"], "completed")
        self.assertTrue(item.get("updated_at"), "写回应记录 updated_at")

    def test_complete_legacy_display_id(self) -> None:
        """展示编号（P-001）与规范编号一样可定位；中文自由值被规范值替换。"""

        result = self.update("P-001", "completed")
        self.assertEqual(result.returncode, 0, result.stderr)
        item = self.state()["pending_items"][1]
        self.assertEqual(item["status"], "completed")
        self.assertEqual(item["title"], "存量待办", "写回不得动状态以外字段")

    def test_reopen_completed_item(self) -> None:
        self.assertEqual(self.update("TASK-0001", "completed").returncode, 0)
        result = self.update("TASK-0001", "open")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state()["pending_items"][0]["status"], "open")

    def test_same_status_is_idempotent_noop(self) -> None:
        result = self.update("TASK-0001", "open")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "unchanged")
        self.assertNotIn("updated_at", self.state()["pending_items"][0],
                         "状态未变不应写入，也不应留时间戳")

    def test_unknown_item_lists_known_ids(self) -> None:
        result = self.update("TASK-9999", "completed")
        self.assertEqual(result.returncode, 2)
        self.assertIn("未找到 Pending Item", result.stderr)
        self.assertIn("TASK-0001", result.stderr)
        self.assertIn("P-001", result.stderr)

    def test_rejects_non_canonical_status(self) -> None:
        """中文自由值是读侧兼容，不是写侧词汇。"""

        result = self.update("TASK-0001", "已完成")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.state()["pending_items"][0]["status"], "open")

    def test_write_goes_through_hash_preflight(self) -> None:
        """与 issue.py 同一通道：基线哈希之外的变化会被拒绝而不是覆盖。"""

        snap = snapshot(self.state_path)
        self.assertEqual(self.update("TASK-0001", "completed").returncode, 0)
        state = self.state()
        self.assertEqual(state["pending_items"][0]["status"], "completed")
        self.assertEqual(state["last_writer"]["harness"], "dsh")
        self.assertNotEqual(snap["sha256"], snapshot(self.state_path)["sha256"])


if __name__ == "__main__":
    unittest.main()
