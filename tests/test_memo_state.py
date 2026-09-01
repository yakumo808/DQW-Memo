import json
import tempfile
import unittest
from pathlib import Path

from dqw_memo import (
    FloatingMemoController,
    MemoState,
    MemoStore,
    format_floating_text,
)


class FakeMemoView:
    def __init__(self) -> None:
        self.visible = False
        self.text = None
        self.topmost = None

    def show(self) -> None:
        self.visible = True

    def hide(self) -> None:
        self.visible = False

    def set_text(self, text: str) -> None:
        self.text = text

    def set_topmost(self, enabled: bool) -> None:
        self.topmost = enabled


class MemoStateTests(unittest.TestCase):
    def test_memo_state_stores_and_updates_arbitrary_text(self):
        state = MemoState("攻略メモ\n・回復は早め\n・バフを維持")

        self.assertEqual(state.text, "攻略メモ\n・回復は早め\n・バフを維持")

        state.update("次のターン: 全体回復")

        self.assertEqual(state.text, "次のターン: 全体回復")

    def test_memo_state_accepts_empty_text_when_clearing_memo(self):
        state = MemoState("一時メモ")

        state.update("")

        self.assertEqual(state.text, "")


class FloatingMemoControllerTests(unittest.TestCase):
    def test_update_displays_latest_memo_and_shows_window(self):
        view = FakeMemoView()
        controller = FloatingMemoController(MemoState("初期メモ"), view)

        controller.update_memo("ボス戦: 回復を優先")

        self.assertEqual(view.text, "ボス戦: 回復を優先")
        self.assertTrue(view.visible)

    def test_set_topmost_passes_enabled_state_to_view(self):
        view = FakeMemoView()
        controller = FloatingMemoController(MemoState(), view)

        controller.set_topmost(False)

        self.assertFalse(view.topmost)


class FormatFloatingTextTests(unittest.TestCase):
    def test_title_blank_line_content_preserves_newlines(self):
        text = format_floating_text("ボス", "1行目\n2行目")
        self.assertEqual(text, "ボス\n\n1行目\n2行目")


class MemoStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / "memos.json"
        self.store = MemoStore(self.path)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_load_missing_file_returns_empty(self):
        ok = self.store.load()
        self.assertTrue(ok)
        self.assertEqual(self.store.get_all(), [])
        self.assertIsNone(self.store.selected_id)

    def test_store_save_and_load_roundtrip(self):
        self.store.create(title="攻略", content="回復\nバフ")
        self.assertTrue(self.store.save())

        other = MemoStore(self.path)
        self.assertTrue(other.load())
        memos = other.get_all()
        self.assertEqual(len(memos), 1)
        self.assertEqual(memos[0]["title"], "攻略")
        self.assertEqual(memos[0]["content"], "回復\nバフ")
        self.assertIn("\n", memos[0]["content"])

    def test_store_multiple_memos(self):
        a = self.store.create(title="A", content="a")
        b = self.store.create(title="B", content="b1\nb2")
        self.assertTrue(self.store.save())
        self.assertEqual(len(self.store.get_all()), 2)
        self.assertNotEqual(a["id"], b["id"])
        ids = {m["id"] for m in self.store.get_all()}
        self.assertEqual(len(ids), 2)

    def test_store_update_preserves_id(self):
        m = self.store.create(title="旧", content="x")
        mid = m["id"]
        updated = self.store.update(mid, "新", "y\nz")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["id"], mid)
        self.assertEqual(updated["title"], "新")
        self.assertEqual(updated["content"], "y\nz")
        self.assertTrue(self.store.save())

        other = MemoStore(self.path)
        self.assertTrue(other.load())
        got = other.get_by_id(mid)
        self.assertIsNotNone(got)
        self.assertEqual(got["content"], "y\nz")

    def test_load_corrupt_json_sets_error_without_raising(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("{not-json", encoding="utf-8")
        ok = self.store.load()
        self.assertFalse(ok)
        self.assertIsNotNone(self.store.last_error)
        self.assertEqual(self.store.get_all(), [])

    def test_legacy_text_only_json(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps({"text": "レガシー\n改行"}, ensure_ascii=False),
            encoding="utf-8",
        )
        ok = self.store.load()
        self.assertTrue(ok)
        self.assertEqual(len(self.store.get_all()), 1)
        self.assertEqual(self.store.get_all()[0]["content"], "レガシー\n改行")


if __name__ == "__main__":
    unittest.main()
