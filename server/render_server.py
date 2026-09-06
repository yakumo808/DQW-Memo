#!/usr/bin/env python3
r"""DQWメモ Phase 3.2 D-3A: render server.

- POST /api/render
  JSON {title, content} -> UTF-8 input.txt -> ffmpeg -> generated.mp4
- GET /videos/<jobId>.mp4
  serve generated mp4 from %LOCALAPPDATA%\DQW-Memo\render-jobs\<jobId>\generated.mp4
- GET / and other static paths
  serve repo root static files (optional convenience)

Standard library only.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import shutil
import threading
import time
from contextlib import contextmanager
import subprocess
import sys
import uuid
from datetime import datetime
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[1]
LOCALAPPDATA = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
APP_DIR = LOCALAPPDATA / "DQW-Memo"
JOBS_DIR = APP_DIR / "render-jobs"
DEFAULT_FONT = Path(r"C:/Windows/Fonts/NotoSansJP-VF.ttf")
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
PORT_DEFAULT = 8782
HOST_DEFAULT = "0.0.0.0"
MAX_POST_BYTES = 1_000_000
VIDEO_WIDTH = 640
VIDEO_HEIGHT = 360
VIDEO_FPS = 30
VIDEO_DURATION = 4
VIDEO_MIME = "video/mp4"


RENDER_JOB_TTL_SECONDS = 24 * 60 * 60
JOB_ID_PATTERN = re.compile(r"\d{8}-\d{6}-[0-9a-f]{12}")
JOB_LOCK = threading.RLock()
ACTIVE_JOBS: set[str] = set()


def cleanup_jobs() -> None:
    """Best-effort cleanup; only this process's active jobs are protected."""
    with JOB_LOCK:
        try:
            root = JOBS_DIR.resolve(strict=True)
            candidates = list(root.iterdir())
        except OSError as exc:
            print(f"job cleanup enumeration failed: {exc}", file=sys.stderr)
            return
        cutoff = time.time() - RENDER_JOB_TTL_SECONDS
        for candidate in candidates:
            try:
                if not JOB_ID_PATTERN.fullmatch(candidate.name) or candidate.name in ACTIVE_JOBS:
                    continue
                if candidate.is_symlink() or candidate.is_junction() or not candidate.is_dir():
                    continue
                # Verify the absolute target before recursive deletion.
                if candidate.resolve(strict=True).parent != root:
                    continue
                if candidate.stat().st_mtime >= cutoff:
                    continue
                shutil.rmtree(candidate)
                print(f"job cleanup removed: {candidate.name}", file=sys.stderr)
            except OSError as exc:
                print(f"job cleanup failed ({candidate.name}): {exc}", file=sys.stderr)


@contextmanager
def active_job(job_id: str):
    with JOB_LOCK:
        ACTIVE_JOBS.add(job_id)
    try:
        yield
    finally:
        with JOB_LOCK:
            try:
                # Start retention at completion, including failed render attempts.
                os.utime(JOBS_DIR / job_id, None)
            except OSError as exc:
                print(f"job completion timestamp failed ({job_id}): {exc}", file=sys.stderr)
            ACTIVE_JOBS.discard(job_id)


def ensure_dirs() -> None:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)


def now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def safe_job_id() -> str:
    return f"{now_stamp()}-{uuid.uuid4().hex[:12]}"


def escape_filter_path(path: Path) -> str:
    # ffmpeg filter parser wants ':' escaped on Windows and backslashes normalized.
    s = str(path).replace("\\", "/")
    return s.replace(":", r"\:")


def json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def tail_text(path: Path, limit: int = 4000) -> str:
    try:
        data = path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return ""
    if len(data) <= limit:
        return data
    return data[-limit:]


def write_text_file(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def render_job(title: str, content: str) -> dict[str, Any]:
    ensure_dirs()
    cleanup_jobs()
    job_id = safe_job_id()
    with active_job(job_id):
        return _render_job(title, content, job_id)


def _render_job(title: str, content: str, job_id: str) -> dict[str, Any]:
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=False)

    input_txt = job_dir / "input.txt"
    output_mp4 = job_dir / "generated.mp4"
    ffmpeg_log = job_dir / "ffmpeg.log"

    # Preserve title + blank line + content exactly, UTF-8.
    text_body = f"{title}\n\n{content}"
    write_text_file(input_txt, text_body)

    if not DEFAULT_FONT.exists():
        raise FileNotFoundError(f"font not found: {DEFAULT_FONT}")

    # Use the same success-friendly delivery shape as D-1/D-2: 640x360, 30fps,
    # H.264 High, yuv420p, faststart, AAC LC silence track, ~4s.
    drawtext = (
        "drawtext="
        f"fontfile='{escape_filter_path(DEFAULT_FONT)}':"
        f"textfile='{escape_filter_path(input_txt)}':"
        "fontsize=28:fontcolor=white:line_spacing=10:"
        "x=(w-text_w)/2:y=(h-text_h)/2:"
        "shadowcolor=black@0.75:shadowx=2:shadowy=2:fix_bounds=1"
    )

    cmd = [
        FFMPEG,
        "-y",
        "-f", "lavfi",
        "-i", f"color=c=0x1f2937:s={VIDEO_WIDTH}x{VIDEO_HEIGHT}:r={VIDEO_FPS}:d={VIDEO_DURATION}",
        "-f", "lavfi",
        "-i", "anullsrc=r=48000:cl=stereo",
        "-vf", drawtext,
        "-c:v", "libx264",
        "-profile:v", "high",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "96k",
        "-shortest",
        "-movflags", "+faststart",
        str(output_mp4),
    ]

    with ffmpeg_log.open("w", encoding="utf-8", newline="\n") as logf:
        logf.write(f"[{datetime.now().isoformat()}] job_id={job_id}\n")
        logf.write(f"input_txt={input_txt}\n")
        logf.write(f"output_mp4={output_mp4}\n")
        logf.write(f"cmd={cmd!r}\n\n")
        proc = subprocess.run(
            cmd,
            stdout=logf,
            stderr=logf,
            shell=False,
            check=False,
        )
        logf.write(f"\n[{datetime.now().isoformat()}] exit_code={proc.returncode}\n")

    if proc.returncode != 0 or not output_mp4.exists():
        raise RuntimeError(
            "ffmpeg failed; see ffmpeg.log: " + tail_text(ffmpeg_log)
        )

    return {
        "jobId": job_id,
        "jobDir": str(job_dir),
        "inputTxt": str(input_txt),
        "outputMp4": str(output_mp4),
        "videoUrl": f"/videos/{job_id}.mp4",
        "width": VIDEO_WIDTH,
        "height": VIDEO_HEIGHT,
        "duration": VIDEO_DURATION,
        "mimeType": VIDEO_MIME,
    }


class RenderHandler(SimpleHTTPRequestHandler):
    server_version = "DQWMemoRenderServer/0.1"

    def __init__(self, *args, directory: str | None = None, **kwargs):
        super().__init__(*args, directory=directory or str(REPO_ROOT), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        # Keep stdlib server logs visible but compact.
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), format % args))

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_POST(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path != "/api/render":
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "errorCode": "INVALID_CONTENT_TYPE", "message": "Content-Type must be application/json"},
            )
            return

        length = self.headers.get("Content-Length")
        try:
            body_len = int(length or "0")
        except ValueError:
            body_len = 0
        if body_len <= 0:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "errorCode": "EMPTY_BODY", "message": "request body is required"},
            )
            return
        if body_len > MAX_POST_BYTES:
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"ok": False, "errorCode": "PAYLOAD_TOO_LARGE", "message": f"request body exceeds {MAX_POST_BYTES} bytes"},
            )
            return

        raw = self.rfile.read(body_len)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "errorCode": "INVALID_JSON", "message": f"invalid JSON: {exc}"},
            )
            return

        title = payload.get("title", "")
        content = payload.get("content", "")
        if not isinstance(title, str) or not isinstance(content, str):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "errorCode": "INVALID_FIELDS", "message": "title and content must be strings"},
            )
            return

        try:
            result = render_job(title, content)
        except FileNotFoundError as exc:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "errorCode": "MISSING_DEPENDENCY", "message": str(exc)},
            )
            return
        except subprocess.CalledProcessError as exc:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "errorCode": "FFMPEG_FAILED", "message": f"ffmpeg exited with {exc.returncode}"},
            )
            return
        except Exception as exc:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "errorCode": "RENDER_FAILED", "message": str(exc)},
            )
            return

        self._send_json(HTTPStatus.OK, {"ok": True, **result})

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path.startswith("/videos/") and parsed.path.endswith(".mp4"):
            self._serve_job_mp4(parsed.path)
            return
        super().do_GET()

    def _serve_job_mp4(self, path: str) -> None:
        job_name = Path(path).name
        job_id = job_name[:-4]  # strip .mp4
        file_path = JOBS_DIR / job_id / "generated.mp4"
        with JOB_LOCK:
            try:
                data = file_path.read_bytes()
                modified = file_path.stat().st_mtime
            except FileNotFoundError:
                self.send_error(HTTPStatus.NOT_FOUND, "rendered mp4 not found")
                return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", VIDEO_MIME)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Last-Modified", self.date_time_string(modified))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    parser = argparse.ArgumentParser(description="DQWメモ render server for Phase 3.2 D-3A")
    parser.add_argument("--host", default=HOST_DEFAULT)
    parser.add_argument("--port", type=int, default=PORT_DEFAULT)
    parser.add_argument("--root", default=str(REPO_ROOT), help="static file root (defaults to repo root)")
    args = parser.parse_args()

    ensure_dirs()
    cleanup_jobs()
    handler = partial(RenderHandler, directory=args.root)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"DQW render server listening on http://{args.host}:{args.port}/")
    print(f"repo root: {args.root}")
    print(f"jobs dir:  {JOBS_DIR}")
    print(f"ffmpeg:    {FFMPEG}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
