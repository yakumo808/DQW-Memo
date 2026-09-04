/**
 * PiP表示のための専用レンダリングエンジン
 * Canvas → captureStream → video → WebKit/Standard PiP
 *
 * capability:
 *   - 'unknown'          未判定
 *   - 'pip_ready'        metadata 確立・PiP 試行可
 *   - 'pip_unavailable'  実行時に PiP 不可（iOS の canvas stream 等）
 */
export class PipRenderer {
  constructor(canvasId, videoId) {
    this.canvas = document.getElementById(canvasId);
    this.video = document.getElementById(videoId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.stream = null;
    this.isActive = false;
    this.currentMemo = null;
    this.ready = false;
    this.capability = 'unknown';
    this.initPromise = null;
    this.initError = null;
    this.initReason = null;

    if (this.video) {
      this.video.muted = true;
      this.video.defaultMuted = true;
      this.video.playsInline = true;
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('webkit-playsinline', '');
      this.video.setAttribute('muted', '');
      this.video.style.display = 'block';
      this.video.style.width = '160px';
      this.video.style.height = '90px';
    }

    if (this.canvas) {
      this.canvas.style.display = 'block';
    }
  }

  getCapability() {
    return {
      capability: this.capability,
      ready: this.ready,
      reason: this.initReason,
      message: this.initError
    };
  }

  /**
   * Editor表示時に一度だけ呼ぶ。
   * @returns {Promise<{ok:boolean, capability:string, reason?:string, message?:string}>}
   */
  init() {
    if (this.ready && this.capability === 'pip_ready') {
      return Promise.resolve({
        ok: true,
        capability: 'pip_ready'
      });
    }
    if (this.capability === 'pip_unavailable' && this.initPromise) {
      return this.initPromise;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInit().catch((e) => {
          const message = (e && e.message) ? e.message : String(e);
          this.ready = false;
          this.capability = 'pip_unavailable';
          this.initReason = 'init_exception';
          this.initError = message;
          this.addLog('PipRenderer: init 未処理例外 - ' + message);
          return {
            ok: false,
            capability: 'pip_unavailable',
            reason: 'init_exception',
            message: message
          };
        });
        return this.initPromise;
      }

      async _doInit() {
        this.initError = null;
        this.initReason = null;

        const fail = (reason, message) => {
          this.ready = false;
          this.capability = 'pip_unavailable';
          this.initReason = reason;
          this.initError = message;
          this.addLog('PipRenderer: 初期化失敗 [' + reason + '] ' + message);
          return {
            ok: false,
            capability: 'pip_unavailable',
            reason: reason,
            message: message
          };
        };

    if (!this.canvas || !this.video || !this.ctx) {
      return fail('missing_elements', 'canvas/video/ctx がありません');
    }

    if (typeof this.canvas.captureStream !== 'function') {
      return fail('no_capture_stream', 'canvas.captureStream 非対応');
    }

    this.canvas.width = 640;
    this.canvas.height = 320;
    this._drawPlaceholder();

    try {
      this.stream = this.canvas.captureStream(30);
    } catch (e) {
      return fail(
        'capture_stream_error',
        e.name + ' - ' + e.message
      );
    }

    const tracks = this.stream.getVideoTracks ? this.stream.getVideoTracks() : [];
    this.addLog(
      'PipRenderer: captureStream OK tracks=' + tracks.length +
      ' (readyState はまだ未確定)'
    );

    if (tracks.length === 0) {
      return fail('no_video_track', 'video track が 0');
    }

    const track = tracks[0];
    if (track && typeof track.requestFrame === 'function') {
      try {
        track.requestFrame();
      } catch (_) {
        /* ignore */
      }
    }

    this.video.srcObject = this.stream;

    try {
      this.video.controls = true;
      this.video.controls = false;
    } catch (_) {
      /* ignore */
    }

    const mediaReady = await this._waitForMediaReady(8000);
    if (!mediaReady) {
      return fail(
        'canvas_stream_no_metadata',
        'loadedmetadata/canplay タイムアウト。' +
        'readyState=' + this.video.readyState +
        ' videoWidth=' + this.video.videoWidth +
        ' videoHeight=' + this.video.videoHeight +
        ' tracks=' + tracks.length +
        '。この環境では canvas.captureStream 由来の video を PiP に使えません。'
      );
    }

    try {
      const p = this.video.play();
      if (p && typeof p.then === 'function') {
        await p;
      }
    } catch (e) {
      this.addLog('PipRenderer: init play() 警告: ' + e.name + ' - ' + e.message);
    }

    this._logMediaSnapshot('init play後');

    if (this.video.readyState < HTMLMediaElement.HAVE_METADATA) {
      return fail(
        'canvas_stream_no_metadata',
        'play()後も readyState < HAVE_METADATA (' + this.video.readyState + ')'
      );
    }

    if (this.video.videoWidth === 0 || this.video.videoHeight === 0) {
      return fail(
        'canvas_stream_no_metadata',
        'videoWidth/Height が 0（メタデータ未確立）'
      );
    }

    this.ready = true;
    this.capability = 'pip_ready';
    this.addLog(
      'PipRenderer: Canvas Stream 準備完了' +
      ' readyState=' + this.video.readyState +
      ' paused=' + this.video.paused +
      ' videoWidth=' + this.video.videoWidth +
      ' videoHeight=' + this.video.videoHeight +
      ' tracks=' + tracks.length
    );

    return { ok: true, capability: 'pip_ready' };
  }

  _waitForMediaReady(timeoutMs) {
    const video = this.video;
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA &&
        video.videoWidth > 0) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(ok);
      };

      const onReady = (ev) => {
        this.addLog('PipRenderer: media event=' + ev.type + ' readyState=' + video.readyState);
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          done(true);
        }
      };

      const events = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'canplaythrough'];
      const cleanup = () => {
        events.forEach((name) => video.removeEventListener(name, onReady));
        clearTimeout(timer);
        clearInterval(poll);
      };

      events.forEach((name) => video.addEventListener(name, onReady));

      const poll = setInterval(() => {
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          this.addLog('PipRenderer: poll readyState=' + video.readyState);
          done(true);
        }
      }, 100);

      const timer = setTimeout(() => {
        this.addLog(
          'PipRenderer: media ready timeout readyState=' + video.readyState +
          ' videoWidth=' + video.videoWidth +
          ' error=' + (video.error ? video.error.message : 'null')
        );
        done(false);
      }, timeoutMs);
    });
  }

  _logMediaSnapshot(label) {
    const tracks = this.stream && this.stream.getVideoTracks
      ? this.stream.getVideoTracks().length
      : 0;
    this.addLog(
      'PipRenderer[' + label + ']:' +
      ' readyState=' + (this.video ? this.video.readyState : 'n/a') +
      ' paused=' + (this.video ? this.video.paused : 'n/a') +
      ' videoWidth=' + (this.video ? this.video.videoWidth : 'n/a') +
      ' videoHeight=' + (this.video ? this.video.videoHeight : 'n/a') +
      ' tracks=' + tracks +
      ' error=' + (this.video && this.video.error ? this.video.error.message : 'null') +
      ' srcObject=' + (this.video && this.video.srcObject ? 'set' : 'null')
    );
  }

  _drawPlaceholder() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.fillStyle = '#1e1e24';
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.fillStyle = '#3b82f6';
    this.ctx.font = '20px sans-serif';
    this.ctx.fillText('DQWメモ', 24, 40);
  }

  isReady() {
    return this.capability === 'pip_ready' && this.ready && this.video &&
      this.video.readyState >= HTMLMediaElement.HAVE_METADATA &&
      this.video.videoWidth > 0;
  }

  render(memo) {
    if (!memo || !this.ctx) return;
    this.currentMemo = memo;
    this.draw(memo.content || '', memo.title || '');

    if (this.stream && this.stream.getVideoTracks) {
      const t = this.stream.getVideoTracks()[0];
      if (t && typeof t.requestFrame === 'function') {
        try {
          t.requestFrame();
        } catch (_) {
          /* ignore */
        }
      }
    }
  }

  draw(text, title) {
    if (!this.canvas || !this.ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.fillStyle = '#1e1e24';
    this.ctx.fillRect(0, 0, w, h);

    this.ctx.strokeStyle = '#3b82f6';
    this.ctx.lineWidth = 6;
    this.ctx.strokeRect(3, 3, w - 6, h - 6);

    this.ctx.fillStyle = '#2d2d3a';
    this.ctx.fillRect(6, 6, w - 12, 40);
    this.ctx.fillStyle = '#3b82f6';
    this.ctx.font = 'bold 20px "Yu Gothic UI", sans-serif';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(title || 'DQWメモ', 24, 26);

    this.ctx.fillStyle = '#f3f4f6';
    this.ctx.font = '20px "Yu Gothic UI", sans-serif';
    this.ctx.textBaseline = 'top';

    const lines = String(text || '').split('\n');
    let currentY = 60;
    const lineHeight = 28;
    const maxY = h - 30;

    for (let i = 0; i < lines.length; i++) {
      if (currentY + lineHeight > maxY) break;
      this.ctx.fillText(lines[i], 24, currentY);
      currentY += lineHeight;
    }

    this.ctx.font = '14px "Yu Gothic UI", sans-serif';
    this.ctx.fillStyle = '#9ca3af';
    this.ctx.fillText('Updated: ' + new Date().toLocaleTimeString(), 24, h - 18);
  }

  /**
   * pip_ready のときだけ呼ぶ。成功は実 PiP 状態確認後のみ。
   * @returns {Promise<{ok:boolean, reason?:string, message?:string}>}
   */
  async startPip() {
    if (!this.video) {
      const message = 'video 要素がありません';
      this.addLog('PiP開始失敗: ' + message);
      return { ok: false, reason: 'missing_video', message: message };
    }

    if (this.capability !== 'pip_ready' || !this.ready) {
      const message = this.initError || 'PiP 非対応（metadata 未確立）';
      this.addLog('PiP開始失敗: APIを呼びません - ' + message);
      return {
        ok: false,
        reason: this.initReason || 'pip_unavailable',
        message: message
      };
    }

    this._logMediaSnapshot('startPip 開始');

    try {
      const p = this.video.play();
      if (p && typeof p.then === 'function') {
        await p;
      }
    } catch (e) {
      const message = 'play() ' + e.name + ' - ' + e.message;
      this.addLog('PiP開始失敗: ' + message);
      return { ok: false, reason: 'play_failed', message: message };
    }

    this._logMediaSnapshot('startPip play後');

    if (this.video.readyState < HTMLMediaElement.HAVE_METADATA ||
        this.video.videoWidth === 0) {
      const message =
        'メタデータ未ロード (readyState=' + this.video.readyState +
        ', videoWidth=' + this.video.videoWidth + ')。PiP API は呼びません。';
      this.addLog('PiP開始失敗: ' + message);
      return { ok: false, reason: 'canvas_stream_no_metadata', message: message };
    }

    try {
      const canWebKit =
        typeof this.video.webkitSupportsPresentationMode === 'function' &&
        this.video.webkitSupportsPresentationMode('picture-in-picture') &&
        typeof this.video.webkitSetPresentationMode === 'function';

      const canStandard =
        document.pictureInPictureEnabled === true &&
        typeof this.video.requestPictureInPicture === 'function';

      this.addLog(
        'PiP API: webkit=' + canWebKit +
        ' standard=' + canStandard +
        ' pictureInPictureEnabled=' + document.pictureInPictureEnabled
      );

      if (canWebKit) {
        this.video.webkitSetPresentationMode('picture-in-picture');
        await this._sleep(250);
        const mode = this.video.webkitPresentationMode;
        this.addLog('webkitPresentationMode=' + mode);
        if (mode === 'picture-in-picture') {
          this.isActive = true;
          this.addLog('PiP開始成功 (WebKit)');
          return { ok: true };
        }
        this.isActive = false;
        const message = 'webkitPresentationMode が picture-in-picture にならない';
        this.addLog('PiP開始失敗 (WebKit): ' + message);
        return { ok: false, reason: 'webkit_mode_unchanged', message: message };
      }

      if (canStandard) {
        await this.video.requestPictureInPicture();
        await this._sleep(100);
        const inPip = document.pictureInPictureElement === this.video;
        this.addLog('pictureInPictureElement match=' + inPip);
        if (inPip) {
          this.isActive = true;
          this.addLog('PiP開始成功 (Standard)');
          return { ok: true };
        }
        this.isActive = false;
        const message = 'Promise は解決したが pictureInPictureElement 不一致';
        this.addLog('PiP開始失敗 (Standard): ' + message);
        return { ok: false, reason: 'pip_element_mismatch', message: message };
      }

      const message = '対応する PiP API がありません';
      this.addLog('PiP開始失敗: ' + message);
      return { ok: false, reason: 'no_pip_api', message: message };
    } catch (e) {
      this.isActive = false;
      const message = e.name + ' - ' + e.message;
      this.addLog('PiP開始失敗: ' + message);
      return { ok: false, reason: 'pip_exception', message: message };
    }
  }

  stopPip() {
    if (this.video) {
      try {
        if (this.video.webkitPresentationMode === 'picture-in-picture' &&
            typeof this.video.webkitSetPresentationMode === 'function') {
          this.video.webkitSetPresentationMode('inline');
        } else if (document.pictureInPictureElement && document.exitPictureInPicture) {
          document.exitPictureInPicture();
        }
      } catch (e) {
        this.addLog('PiP終了エラー: ' + e.message);
      }
    }
    this.isActive = false;
    this.addLog('PiP終了');
  }

  getIsActive() {
    return this.isActive;
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  addLog(msg) {
    const logBox = document.getElementById('log-box');
    const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    if (logBox) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.textContent = line;
      logBox.appendChild(entry);
      logBox.scrollTop = logBox.scrollHeight;
    }
    try {
      console.log(line);
    } catch (_) {
      /* ignore */
    }
  }
}
