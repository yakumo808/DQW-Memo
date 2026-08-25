import unittest

from dqw_memo import FloatingMemoController, MemoState


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


if __name__ == "__main__":
    unittest.main()
