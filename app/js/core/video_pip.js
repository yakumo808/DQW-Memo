/**
 * Phase 3.1 — 通常 video（mp4）によるシステム PiP
 * Spike 002 と同じ経路。canvas.captureStream / MediaStream は使わない。
 *
 * ユーザージェスチャー: prepare/load は Editor 表示時など事前に行い、
 * PiP ボタンでは play + PiP API のみ（再 load しない）。
 */

export const DEFAULT_SAMPLE_MP4 = './spikes/002-ios-video-pip/sample.mp4';

export class VideoPipController {
  /**
   * @param {string} videoId
   * @param {{ log?: function(string): void }} [options]
   */
  constructor(videoId, options) {
    this.video = document.getElementById(videoId);
    this.logFn = (options && options.log) || null;
    this.src = DEFAULT_SAMPLE_MP4;
    /** @type {Promise<{ok:boolean, message?:string}> | null} */
    this._preparePromise = null;
  }

  log(msg) {
    const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    if (this.logFn) this.logFn(line);
    const logBox = document.getElementById('log-box');
    if (logBox) {
      const el = document.createElement('div');
      el.className = 'log-entry';
      el.textContent = line;
      logBox.appendChild(el);
      logBox.scrollTop = logBox.scrollHeight;
    }
    try {
      console.log(line);
    } catch (_) {
      /* ignore */
    }
  }

  snapshot(label) {
    const v = this.video;
    if (!v) return 'video missing';
    let webkitMode = 'n/a';
    try {
      if ('webkitPresentationMode' in v) webkitMode = String(v.webkitPresentationMode);
    } catch (_) {
      /* ignore */
    }
    return (
      label +
      ' readyState=' + v.readyState +
      ' networkState=' + v.networkState +
      ' error=' + (v.error ? v.error.code + ':' + v.error.message : 'none') +
      ' assignedSrc=' + (v.getAttribute('src') || '') +
      ' videoWidth=' + v.videoWidth +
      ' videoHeight=' + v.videoHeight +
      ' paused=' + v.paused +
      ' src=' + (v.currentSrc || v.src || '') +
      ' webkitMode=' + webkitMode +
      ' pipEl=' + (document.pictureInPictureElement === v)
    );
  }

  /**
   * 同一 URL で metadata が既に揃っているか
   */
  isReadyForPip(src) {
    const v = this.video;
    if (!v) return false;
    const want = src || this.src || DEFAULT_SAMPLE_MP4;
    if (!this._srcMatches(want)) return false;
    return v.readyState >= 1 && v.videoWidth > 0;
  }

  _srcMatches(want) {
    const v = this.video;
    if (!v) return false;
    const current = v.currentSrc || v.getAttribute('src') || v.src || '';
    if (!current && !want) return false;
    // absolute vs relative
    try {
      const absWant = new URL(want, window.location.href).href;
      if (current === absWant) return true;
      if (current.endsWith(want.replace(/^\.\//, ''))) return true;
      if (current.indexOf('sample.mp4') !== -1 && want.indexOf('sample.mp4') !== -1) {
        return true;
      }
    } catch (_) {
      /* ignore */
    }
    return current === want || (v.getAttribute('src') === want);
  }

  /**
   * Editor 表示時などの先読み。PiP ボタンからは呼ばない（ジェスチャー保護）。
   * 同じ URL で既に ready なら load() しない。
   * @param {string} [src]
   * @returns {Promise<{ok:boolean, message?:string, skipped?:boolean}>}
   */
  prepare(src) {
    const url = src || this.src || DEFAULT_SAMPLE_MP4;
    this.src = url;

    if (this.isReadyForPip(url)) {
      this.log(this.snapshot('prepare-skip-already-ready'));
      return Promise.resolve({ ok: true, skipped: true });
    }

    if (this._preparePromise) {
      return this._preparePromise;
    }

    this._preparePromise = this._doPrepare(url).finally(() => {
      this._preparePromise = null;
    });
    return this._preparePromise;
  }

  async _doPrepare(url) {
    if (!this.video) {
      return { ok: false, reason: 'video-missing', message: 'video 要素がありません' };
    }

    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('webkit-playsinline', '');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.defaultMuted = true;
    this.video.loop = true;

    const needAssign = !this._srcMatches(url);
    this.log(
      'VideoPip: prepare src=' + url +
      ' needAssign=' + needAssign +
      ' ' + this.snapshot('before')
    );

    const started = performance.now();
    const eventNames = ['loadedmetadata', 'loadeddata', 'canplay', 'error', 'abort', 'stalled', 'loadstart', 'emptied', 'suspend'];
    const onEvent = event => this.log(this.snapshot(
      `prepare-event=${event.type} target=${url} elapsedMs=${Math.round(performance.now() - started)}`));
    eventNames.forEach(name => this.video.addEventListener(name, onEvent));
    try {
      if (needAssign) {
        this.video.src = url;
        try {
          this.video.load();
        } catch (error) {
          this.log(`prepare-load-error target=${url} error=${error}`);
        }
      } else if (!(this.video.readyState >= 1 && this.video.videoWidth > 0)) {
        // URL は同じだが未 ready → load は1回だけ（先読み用）
        try {
          this.video.load();
        } catch (error) {
          this.log(`prepare-load-error target=${url} error=${error}`);
        }
      }

      const result = await this._waitForMetadata(12000);
      this.log(this.snapshot(`prepare-result target=${url} elapsedMs=${Math.round(performance.now() - started)}`));

      if (!result.ok) {
        return {
          ok: false,
          reason: result.reason,
          message:
            'メタデータ未確立 readyState=' + this.video.readyState +
            ' videoWidth=' + this.video.videoWidth
        };
      }
      return { ok: true };
    } finally {
      eventNames.forEach(name => this.video.removeEventListener(name, onEvent));
    }
  }

  _waitForMetadata(timeoutMs) {
    const v = this.video;
    const ready = () => v.readyState >= 1 && v.videoWidth > 0;
    if (ready()) return Promise.resolve({ ok: true });
    return new Promise(resolve => {
      let done = false;
      let lastInterruption = '';
      let timer;
      const events = ['loadedmetadata', 'loadeddata', 'canplay', 'error', 'abort', 'stalled'];
      const finish = result => {
        if (done) return;
        done = true;
        events.forEach(e => v.removeEventListener(e, onEvent));
        clearTimeout(timer);
        resolve(result);
      };
      const onEvent = event => {
        if (v.error) { finish({ ok: false, reason: 'metadata-error' }); return; }
        if (ready()) { finish({ ok: true }); return; }
        // load() itself can emit abort for the old resource. Do not fail early.
        if (event && ['abort', 'stalled'].includes(event.type)) lastInterruption = event.type;
      };
      events.forEach(e => v.addEventListener(e, onEvent));
      timer = setTimeout(() => finish({ ok: false, reason: 'metadata-' + (lastInterruption || 'timeout') }), timeoutMs);
      onEvent();
    });
  }

  /**
   * ユーザージェスチャー内専用。
   * 準備済みなら load せず play → PiP のみ。
   * 未準備なら ok:false / reason: 'not_ready'（呼び出し側で二段階案内）
   * @returns {Promise<{ok:boolean, message?:string, api?:string, reason?:string}>}
   */
  async startPip() {
    const v = this.video;
    if (!v) {
      return { ok: false, message: 'video 要素がありません' };
    }

    this.log(this.snapshot('startPip-begin'));

    // クリック時は再 load しない。未 ready なら即 return
    if (!this.isReadyForPip(this.src)) {
      const message =
        '動画未準備 readyState=' + v.readyState +
        ' videoWidth=' + v.videoWidth +
        ' — 先に準備してから、もう一度「PiPで表示」をタップしてください';
      this.log(message);
      return { ok: false, reason: 'not_ready', message: message };
    }

    try {
      v.muted = true;
      if (v.paused) {
        const p = v.play();
        if (p && typeof p.then === 'function') await p;
      }
      this.log(this.snapshot('after-play'));
    } catch (e) {
      const message = 'play() 失敗: ' + e.name + ' - ' + e.message;
      this.log(message);
      return { ok: false, message: message };
    }

    // play 後の再確認（load はしない）
    if (v.readyState < 1 || v.videoWidth === 0) {
      const message = 'play 後も metadata 不足（再 load はしません）';
      this.log(message);
      return { ok: false, message: message };
    }

    try {
      const canWebKit =
        typeof v.webkitSupportsPresentationMode === 'function' &&
        v.webkitSupportsPresentationMode('picture-in-picture') &&
        typeof v.webkitSetPresentationMode === 'function';

      const canStandard =
        document.pictureInPictureEnabled === true &&
        typeof v.requestPictureInPicture === 'function';

      this.log(
        'PiP API webkit=' + canWebKit +
        ' standard=' + canStandard +
        ' pictureInPictureEnabled=' + document.pictureInPictureEnabled
      );

      if (canWebKit) {
        v.webkitSetPresentationMode('picture-in-picture');
        await new Promise((r) => setTimeout(r, 300));
        const mode = v.webkitPresentationMode;
        this.log('webkitPresentationMode=' + mode);
        if (mode === 'picture-in-picture') {
          this.log('PiP開始成功 (WebKit)');
          return { ok: true, api: 'webkit' };
        }
        return {
          ok: false,
          message: 'WebKit: presentationMode が picture-in-picture ではない (' + mode + ')'
        };
      }

      if (canStandard) {
        await v.requestPictureInPicture();
        await new Promise((r) => setTimeout(r, 100));
        const match = document.pictureInPictureElement === v;
        this.log('pictureInPictureElement===video: ' + match);
        if (match) {
          this.log('PiP開始成功 (Standard)');
          return { ok: true, api: 'standard' };
        }
        return { ok: false, message: 'Standard: pictureInPictureElement 不一致' };
      }

      return { ok: false, message: '対応する PiP API がありません' };
    } catch (e) {
      const message = e.name + ' - ' + e.message;
      this.log('PiP例外: ' + message);
      return { ok: false, message: message };
    }
  }

  async stopPip() {
    const v = this.video;
    if (!v) return;
    try {
      if (v.webkitPresentationMode === 'picture-in-picture' &&
          typeof v.webkitSetPresentationMode === 'function') {
        v.webkitSetPresentationMode('inline');
      } else if (document.pictureInPictureElement && document.exitPictureInPicture) {
        await document.exitPictureInPicture();
      }
      this.log('PiP終了');
    } catch (e) {
      this.log('PiP終了例外: ' + e.message);
    }
  }
}
