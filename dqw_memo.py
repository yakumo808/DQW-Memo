"""DQWメモ Phase 1: ゲーム画面に重ねて使うフローティングメモ。"""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Protocol


APP_TITLE = "DQWメモ"
EMPTY_MEMO_HINT = "（メモは空です）"


class MemoState:
    """フローティング表示用メモ本文の小さな状態オブジェクト。"""

    def __init__(self, text: str = "") -> None:
        self.text = text

    def update(self, text: str) -> None:
        self.text = text


class MemoView(Protocol):
    def show(self) -> None: ...

    def hide(self) -> None: ...

    def set_text(self, text: str) -> None: ...

    def set_topmost(self, enabled: bool) -> None: ...


class FloatingMemoController:
    """メモ本文とフローティング表示の同期を担う。"""

    def __init__(self, state: MemoState, view: MemoView) -> None:
        self.state = state
        self.view = view

    def update_memo(self, text: str) -> None:
        self.state.update(text)
        self.view.set_text(text)
        self.view.show()

    def hide_memo(self) -> None:
        self.view.hide()

    def set_topmost(self, enabled: bool) -> None:
        self.view.set_topmost(enabled)


class TkFloatingMemoWindow:
    """移動・リサイズ可能な常時最前面メモウィンドウ。"""

    def __init__(self, root: tk.Tk, on_topmost_changed) -> None:
        self.window = tk.Toplevel(root)
        self.window.title("DQWメモ - フローティング")
        self.window.geometry("360x260+100+100")
        self.window.minsize(220, 140)
        self.window.resizable(True, True)
        self.window.attributes("-topmost", True)
        self.window.protocol("WM_DELETE_WINDOW", self.hide)
        self._drag_origin: tuple[int, int] | None = None

        outer = ttk.Frame(self.window, padding=8)
        outer.pack(fill="both", expand=True)

        header = ttk.Frame(outer)
        header.pack(fill="x", pady=(0, 6))
        self.title_label = ttk.Label(header, text="DQWメモ", font=("Yu Gothic UI", 11, "bold"))
        self.title_label.pack(side="left")

        self.topmost_var = tk.BooleanVar(value=True)
        self.topmost_check = ttk.Checkbutton(
            header,
            text="常に最前面",
            variable=self.topmost_var,
            command=lambda: on_topmost_changed(self.topmost_var.get()),
        )
        self.topmost_check.pack(side="right")

        self.text_widget = tk.Text(
            outer,
            wrap="word",
            font=("Yu Gothic UI", 11),
            padx=8,
            pady=8,
            relief="solid",
            borderwidth=1,
            state="disabled",
        )
        self.text_widget.pack(fill="both", expand=True)

        # 標準タイトルバーに加え、アプリ内の見出しでもドラッグ移動できる。
        for widget in (header, self.title_label):
            widget.bind("<ButtonPress-1>", self._start_drag)
            widget.bind("<B1-Motion>", self._drag_window)

        self.set_text("")

    def _start_drag(self, event: tk.Event) -> None:
        self._drag_origin = (event.x_root, event.y_root)

    def _drag_window(self, event: tk.Event) -> None:
        if self._drag_origin is None:
            return
        old_x, old_y = self._drag_origin
        new_x = self.window.winfo_x() + event.x_root - old_x
        new_y = self.window.winfo_y() + event.y_root - old_y
        self.window.geometry(f"+{new_x}+{new_y}")
        self._drag_origin = (event.x_root, event.y_root)

    def show(self) -> None:
        self.window.deiconify()
        self.window.lift()

    def hide(self) -> None:
        self.window.withdraw()

    def set_text(self, text: str) -> None:
        display_text = text if text else EMPTY_MEMO_HINT
        self.text_widget.configure(state="normal")
        self.text_widget.delete("1.0", "end")
        self.text_widget.insert("1.0", display_text)
        self.text_widget.configure(state="disabled")

    def set_topmost(self, enabled: bool) -> None:
        self.topmost_var.set(enabled)
        self.window.attributes("-topmost", enabled)
        if enabled:
            self.window.lift()

    def destroy(self) -> None:
        self.window.destroy()


class DqwMemoApp:
    """編集画面とフローティングウィンドウを組み立てるアプリケーション。"""

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title(APP_TITLE)
        self.root.geometry("520x430")
        self.root.minsize(380, 300)
        self.root.protocol("WM_DELETE_WINDOW", self.quit)

        self.state = MemoState()
        self.topmost_var = tk.BooleanVar(value=True)
        self.floating_view = TkFloatingMemoWindow(root, self._on_floating_topmost_changed)
        self.controller = FloatingMemoController(self.state, self.floating_view)

        self._build_editor()
        self.editor.focus_set()

    def _build_editor(self) -> None:
        outer = ttk.Frame(self.root, padding=14)
        outer.pack(fill="both", expand=True)

        ttk.Label(outer, text="メモ本文", font=("Yu Gothic UI", 12, "bold")).pack(anchor="w")
        ttk.Label(
            outer,
            text="ゲーム中に確認したい攻略メモを入力してください。",
        ).pack(anchor="w", pady=(2, 8))

        self.editor = tk.Text(outer, wrap="word", font=("Yu Gothic UI", 11), undo=True, padx=8, pady=8)
        self.editor.pack(fill="both", expand=True)
        self.editor.bind("<KeyRelease>", self._sync_if_visible)
        self.editor.bind("<Control-Return>", self._update_and_show_event)

        controls = ttk.Frame(outer)
        controls.pack(fill="x", pady=(10, 0))
        ttk.Checkbutton(
            controls,
            text="フローティングメモを常に最前面に表示",
            variable=self.topmost_var,
            command=self._apply_topmost,
        ).pack(side="left")

        ttk.Button(controls, text="表示を閉じる", command=self.controller.hide_memo).pack(side="right")
        ttk.Button(controls, text="更新して表示", command=self.update_and_show).pack(side="right", padx=(0, 8))

        ttk.Label(outer, text="ヒント: Ctrl + Enter でも更新して表示できます。", foreground="#666666").pack(
            anchor="w", pady=(8, 0)
        )

    def _editor_text(self) -> str:
        return self.editor.get("1.0", "end-1c")

    def _sync_if_visible(self, _event: tk.Event) -> None:
        if self.floating_view.window.state() != "withdrawn":
            self.controller.update_memo(self._editor_text())

    def _update_and_show_event(self, _event: tk.Event) -> str:
        self.update_and_show()
        return "break"

    def update_and_show(self) -> None:
        self.controller.update_memo(self._editor_text())
        self._apply_topmost()

    def _apply_topmost(self) -> None:
        self.controller.set_topmost(self.topmost_var.get())

    def _on_floating_topmost_changed(self, enabled: bool) -> None:
        self.topmost_var.set(enabled)
        self.controller.set_topmost(enabled)

    def quit(self) -> None:
        self.floating_view.destroy()
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    DqwMemoApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
