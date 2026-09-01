"""DQWメモ Phase 1: ゲーム画面に重ねて使うフローティングメモ。"""

from __future__ import annotations

import json
import os
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Protocol

import tkinter as tk
from tkinter import messagebox, ttk

APP_TITLE = "DQWメモ"
EMPTY_MEMO_HINT = "（メモは空です）"
STORE_VERSION = 1


def default_store_path() -> Path:
    base = os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / "DQW-Memo" / "memos.json"
    return Path.home() / ".dqw-memo" / "memos.json"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


def format_floating_text(title: str, content: str) -> str:
    """フローティング表示用: タイトル + 空行 + 本文（改行保持）。"""
    t = (title or "").strip() or "（無題）"
    c = content if content is not None else ""
    if c == "":
        return f"{t}\n\n{EMPTY_MEMO_HINT}"
    return f"{t}\n\n{c}"


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


class MemoStore:
    """複数メモの JSON 永続化。"""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path if path is not None else default_store_path()
        self.version = STORE_VERSION
        self.memos: list[dict[str, Any]] = []
        self.selected_id: str | None = None
        self.last_error: str | None = None

    def clear_error(self) -> None:
        self.last_error = None

    def load(self) -> bool:
        """ファイルを読む。成功 True。欠損は空で成功。破損等は False と last_error。"""
        self.clear_error()
        if not self.path.exists():
            self.memos = []
            self.selected_id = None
            return True
        try:
            raw = self.path.read_text(encoding="utf-8")
            data = json.loads(raw)
            return self._apply_loaded(data)
        except OSError as e:
            self.last_error = f"読み込みに失敗しました（権限・I/O）: {e}"
            self.memos = []
            self.selected_id = None
            return False
        except json.JSONDecodeError as e:
            self.last_error = f"JSONが破損しています: {e}"
            self.memos = []
            self.selected_id = None
            return False
        except Exception as e:  # noqa: BLE001 — UI に返す
            self.last_error = f"読み込みエラー: {e}"
            self.memos = []
            self.selected_id = None
            return False

    def _apply_loaded(self, data: Any) -> bool:
        # レガシー: {"text": "..."} のみ
        if isinstance(data, dict) and "memos" not in data and "text" in data:
            text = data.get("text") or ""
            mid = _new_id()
            self.memos = [
                {
                    "id": mid,
                    "title": "",
                    "content": str(text),
                    "updated": _utc_now_iso(),
                }
            ]
            self.selected_id = mid
            self.version = STORE_VERSION
            return True

        if not isinstance(data, dict):
            self.last_error = "JSONの形式が不正です（オブジェクトではありません）"
            self.memos = []
            self.selected_id = None
            return False

        memos_in = data.get("memos", [])
        if not isinstance(memos_in, list):
            self.last_error = "JSONの形式が不正です（memos が配列ではありません）"
            self.memos = []
            self.selected_id = None
            return False

        cleaned: list[dict[str, Any]] = []
        for item in memos_in:
            if not isinstance(item, dict):
                continue
            mid = str(item.get("id") or _new_id())
            cleaned.append(
                {
                    "id": mid,
                    "title": str(item.get("title") or ""),
                    "content": str(item.get("content") or ""),
                    "updated": str(item.get("updated") or _utc_now_iso()),
                }
            )

        self.memos = cleaned
        self.version = int(data.get("version") or STORE_VERSION)
        sel = data.get("selectedId")
        if sel is not None:
            sel = str(sel)
        if sel and any(m["id"] == sel for m in self.memos):
            self.selected_id = sel
        elif self.memos:
            self.selected_id = self._newest_id()
        else:
            self.selected_id = None
        return True

    def _newest_id(self) -> str | None:
        if not self.memos:
            return None
        ordered = sorted(self.memos, key=lambda m: m.get("updated") or "", reverse=True)
        return ordered[0]["id"]

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": STORE_VERSION,
            "selectedId": self.selected_id,
            "memos": list(self.memos),
        }

    def save(self) -> bool:
        """JSON を保存。失敗時 False と last_error。例外は外へ出さない。"""
        self.clear_error()
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            payload = json.dumps(self.to_dict(), ensure_ascii=False, indent=2)
            tmp = self.path.with_suffix(self.path.suffix + ".tmp")
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(self.path)
            return True
        except OSError as e:
            self.last_error = f"保存に失敗しました（権限・I/O）: {e}"
            return False
        except Exception as e:  # noqa: BLE001
            self.last_error = f"保存エラー: {e}"
            return False

    def get_all(self) -> list[dict[str, Any]]:
        return list(self.memos)

    def get_by_id(self, memo_id: str) -> dict[str, Any] | None:
        for m in self.memos:
            if m["id"] == memo_id:
                return dict(m)
        return None

    def get_selected(self) -> dict[str, Any] | None:
        if not self.selected_id:
            return None
        return self.get_by_id(self.selected_id)

    def create(self, title: str = "", content: str = "") -> dict[str, Any]:
        memo = {
            "id": _new_id(),
            "title": title or "",
            "content": content if content is not None else "",
            "updated": _utc_now_iso(),
        }
        self.memos.append(memo)
        self.selected_id = memo["id"]
        return dict(memo)

    def update(self, memo_id: str, title: str, content: str) -> dict[str, Any] | None:
        for m in self.memos:
            if m["id"] == memo_id:
                m["title"] = title or ""
                m["content"] = content if content is not None else ""
                m["updated"] = _utc_now_iso()
                self.selected_id = memo_id
                return dict(m)
        return None

    def select(self, memo_id: str | None) -> None:
        if memo_id and any(m["id"] == memo_id for m in self.memos):
            self.selected_id = memo_id
        elif not memo_id:
            self.selected_id = None


class TkFloatingMemoWindow:
    """移動・リサイズ可能な常時最前面メモウィンドウ。"""

    def __init__(self, root: tk.Tk, on_topmost_changed: Callable[[bool], None]) -> None:
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

    def __init__(self, root: tk.Tk, store: MemoStore | None = None) -> None:
        self.root = root
        self.root.title(APP_TITLE)
        self.root.geometry("720x480")
        self.root.minsize(520, 360)
        self.root.protocol("WM_DELETE_WINDOW", self.quit)

        self.store = store if store is not None else MemoStore()
        self.state = MemoState()
        self.topmost_var = tk.BooleanVar(value=True)
        self.floating_view = TkFloatingMemoWindow(root, self._on_floating_topmost_changed)
        self.controller = FloatingMemoController(self.state, self.floating_view)

        self._list_ids: list[str] = []
        self._loading_ui = False

        self._build_editor()
        self._load_initial()
        self.title_entry.focus_set()

    def _build_editor(self) -> None:
        outer = ttk.Frame(self.root, padding=12)
        outer.pack(fill="both", expand=True)

        ttk.Label(outer, text="DQWメモ", font=("Yu Gothic UI", 14, "bold")).pack(anchor="w")
        ttk.Label(
            outer,
            text="一覧から呼び出し、編集して保存。フローティングはゲーム上に重ねて表示します。",
        ).pack(anchor="w", pady=(2, 8))

        paned = ttk.Panedwindow(outer, orient=tk.HORIZONTAL)
        paned.pack(fill="both", expand=True)

        left = ttk.Frame(paned, padding=(0, 0, 8, 0))
        right = ttk.Frame(paned, padding=(8, 0, 0, 0))
        paned.add(left, weight=1)
        paned.add(right, weight=3)

        ttk.Label(left, text="メモ一覧", font=("Yu Gothic UI", 11, "bold")).pack(anchor="w")
        list_frame = ttk.Frame(left)
        list_frame.pack(fill="both", expand=True, pady=(4, 0))
        scroll = ttk.Scrollbar(list_frame)
        scroll.pack(side="right", fill="y")
        self.listbox = tk.Listbox(
            list_frame,
            exportselection=False,
            font=("Yu Gothic UI", 10),
            yscrollcommand=scroll.set,
        )
        self.listbox.pack(side="left", fill="both", expand=True)
        scroll.config(command=self.listbox.yview)
        self.listbox.bind("<<ListboxSelect>>", self._on_list_select)

        ttk.Label(right, text="タイトル", font=("Yu Gothic UI", 11, "bold")).pack(anchor="w")
        self.title_entry = ttk.Entry(right, font=("Yu Gothic UI", 11))
        self.title_entry.pack(fill="x", pady=(4, 8))

        ttk.Label(right, text="本文", font=("Yu Gothic UI", 11, "bold")).pack(anchor="w")
        self.editor = tk.Text(right, wrap="word", font=("Yu Gothic UI", 11), undo=True, padx=8, pady=8)
        self.editor.pack(fill="both", expand=True, pady=(4, 0))
        self.editor.bind("<KeyRelease>", self._sync_if_visible)
        self.editor.bind("<Control-Return>", self._update_and_show_event)
        self.title_entry.bind("<KeyRelease>", self._sync_if_visible)
        self.title_entry.bind("<Control-Return>", self._update_and_show_event)

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
        ttk.Button(controls, text="保存", command=self.save_current).pack(side="right", padx=(0, 8))
        ttk.Button(controls, text="新規", command=self.create_new).pack(side="right", padx=(0, 8))

        self.status_var = tk.StringVar(value="")
        ttk.Label(outer, textvariable=self.status_var, foreground="#666666").pack(anchor="w", pady=(8, 0))
        ttk.Label(
            outer,
            text="ヒント: Ctrl+Enter で更新して表示。データ: %LOCALAPPDATA%\\DQW-Memo\\memos.json",
            foreground="#666666",
        ).pack(anchor="w", pady=(4, 0))

    def _load_initial(self) -> None:
        ok = self.store.load()
        if not ok:
            self._set_status(self.store.last_error or "読み込みに失敗しました")
            messagebox.showwarning("読み込みエラー", self.store.last_error or "読み込みに失敗しました")
        self._refresh_list()
        sel = self.store.get_selected()
        if sel:
            self._load_memo_into_editor(sel)
        else:
            self._clear_editor()
        if ok and self.store.memos:
            self._set_status(f"{len(self.store.memos)} 件のメモを読み込みました")
        elif ok:
            self._set_status("メモはまだありません。「新規」から作成できます")

    def _set_status(self, text: str) -> None:
        self.status_var.set(text)

    def _memo_list_label(self, memo: dict) -> str:
        title = (memo.get("title") or "").strip() or "（無題）"
        updated = (memo.get("updated") or "")[:19].replace("T", " ")
        return f"{title}  [{updated}]" if updated else title

    def _refresh_list(self) -> None:
        self._loading_ui = True
        try:
            self.listbox.delete(0, "end")
            ordered = sorted(
                self.store.get_all(),
                key=lambda m: m.get("updated") or "",
                reverse=True,
            )
            self._list_ids = [m["id"] for m in ordered]
            for m in ordered:
                self.listbox.insert("end", self._memo_list_label(m))
            sel = self.store.selected_id
            if sel and sel in self._list_ids:
                idx = self._list_ids.index(sel)
                self.listbox.selection_clear(0, "end")
                self.listbox.selection_set(idx)
                self.listbox.see(idx)
        finally:
            self._loading_ui = False

    def _clear_editor(self) -> None:
        self._loading_ui = True
        try:
            self.title_entry.delete(0, "end")
            self.editor.delete("1.0", "end")
        finally:
            self._loading_ui = False

    def _load_memo_into_editor(self, memo: dict) -> None:
        self._loading_ui = True
        try:
            self.title_entry.delete(0, "end")
            self.title_entry.insert(0, memo.get("title") or "")
            self.editor.delete("1.0", "end")
            self.editor.insert("1.0", memo.get("content") or "")
            self.store.select(memo["id"])
        finally:
            self._loading_ui = False

    def _editor_title(self) -> str:
        return self.title_entry.get()

    def _editor_content(self) -> str:
        return self.editor.get("1.0", "end-1c")

    def _on_list_select(self, _event: tk.Event | None = None) -> None:
        if self._loading_ui:
            return
        sel = self.listbox.curselection()
        if not sel:
            return
        idx = int(sel[0])
        if idx < 0 or idx >= len(self._list_ids):
            return
        memo_id = self._list_ids[idx]
        memo = self.store.get_by_id(memo_id)
        if memo:
            self._load_memo_into_editor(memo)
            self._set_status("メモを呼び出しました")

    def create_new(self) -> None:
        memo = self.store.create(title="", content="")
        if not self.store.save():
            messagebox.showerror("保存エラー", self.store.last_error or "保存に失敗しました")
            self._set_status(self.store.last_error or "保存に失敗しました")
        self._refresh_list()
        self._load_memo_into_editor(memo)
        self.title_entry.focus_set()
        self._set_status("新規メモを作成しました")

    def save_current(self) -> bool:
        title = self._editor_title()
        content = self._editor_content()
        sel_id = self.store.selected_id
        if not sel_id:
            memo = self.store.create(title=title, content=content)
            sel_id = memo["id"]
        else:
            updated = self.store.update(sel_id, title, content)
            if updated is None:
                memo = self.store.create(title=title, content=content)
                sel_id = memo["id"]
        if not self.store.save():
            messagebox.showerror("保存エラー", self.store.last_error or "保存に失敗しました")
            self._set_status(self.store.last_error or "保存に失敗しました")
            return False
        self._refresh_list()
        self._set_status("保存しました")
        return True

    def _floating_payload(self) -> str:
        return format_floating_text(self._editor_title(), self._editor_content())

    def _sync_if_visible(self, _event: tk.Event | None = None) -> None:
        if self._loading_ui:
            return
        try:
            if self.floating_view.window.state() != "withdrawn":
                self.controller.update_memo(self._floating_payload())
        except tk.TclError:
            pass

    def _update_and_show_event(self, _event: tk.Event) -> str:
        self.update_and_show()
        return "break"

    def update_and_show(self) -> None:
        # 表示前に保存を試みる（失敗しても表示は行う）
        self.save_current()
        self.controller.update_memo(self._floating_payload())
        self._apply_topmost()
        self._set_status("フローティングに表示しました")

    def _apply_topmost(self) -> None:
        self.controller.set_topmost(self.topmost_var.get())

    def _on_floating_topmost_changed(self, enabled: bool) -> None:
        self.topmost_var.set(enabled)
        self.controller.set_topmost(enabled)

    def quit(self) -> None:
        try:
            self.floating_view.destroy()
        except tk.TclError:
            pass
        self.root.destroy()


def main() -> None:
    try:
        root = tk.Tk()
        DqwMemoApp(root)
        root.mainloop()
    except Exception:  # noqa: BLE001
        err = traceback.format_exc()
        try:
            messagebox.showerror("起動エラー", err)
        except Exception:
            print(err)


if __name__ == "__main__":
    main()
