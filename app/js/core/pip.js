/**
 * PiP表示のための専用レンダリングエンジン
 */
export class PipRenderer {
  constructor(canvasId, videoId) {
    this.canvas = document.getElementById(canvasId);
    this.video = document.getElementById(videoId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.stream = null;
    this.isActive = false;
    this.currentMemo = null;
    this.animationFrameId = null;

    if (this.canvas && this.video) {
      // ビデオ要素をDOM上で有効な状態にする
      this.video.style.display = 'block';
      this.video.muted = true;
      this.video.playsInline = true;
      this.addLog('PipRenderer: 初期化完了 (videoはDOM上で有効)');
    }
  }

  init() {
    if (!this.canvas || !this.video || !this.ctx) {
      this.addLog('PipRenderer: 初期化失敗 (要素不足)');
      return;
    }
    this.canvas.width = 640;
    this.canvas.height = 320;

    try {
      this.stream = this.canvas.captureStream(30);
      this.video.srcObject = this.stream;
      this.addLog(`PipRenderer: Canvas Stream 接続完了 (readyState: ${this.video.readyState}, paused: ${this.video.paused}, error: ${this.video.error})`);
    } catch (e) {
      this.addLog(`PipRenderer: Canvas Stream 接続失敗: ${e.name} - ${e.message}`);
    }
  }

  render(memo) {
    if (!memo || !this.ctx) return;
    this.currentMemo = memo;
    this.draw(this.currentMemo.content);
  }

  draw(text) {
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
    this.ctx.fillText(this.currentMemo.title || 'DQWメモ', w / 2 - 50, 25);

    this.ctx.fillStyle = '#f3f4f6';
    this.ctx.font = '20px "Yu Gothic UI", sans-serif';
    this.ctx.textBaseline = 'top';

    const lines = text.split('\n');
    let currentY = 60;
    const max_h = h - 80;

    lines.forEach((line) => {
      if (currentY + 38 > max_h) {
        const words = line.split(' ');
        let currentLine = '';
        for (let word of words) {
          if ((currentLine + word).length > 45) {
            this.ctx.fillText(currentLine, 30, currentY);
            currentY += 38;
            currentLine = word + ' ';
          } else {
            currentLine += word + ' ';
          }
        }
      } else {
        this.ctx.fillText(line, 30, currentY);
        currentY += 38;
      }
    });

    this.ctx.font = '14px "Yu Gothic UI", sans-serif';
    this.ctx.fillStyle = '#9ca3af';
    this.ctx.fillText(`Updated: ${new Date().toLocaleTimeString()}`, 30, h - 15);
  }

  async startPip() {
    if (!this.currentMemo || !this.video) {
      this.addLog('PiP開始失敗: メモまたはビデオ要素がありません');
      return;
    }

    try {
      // ビデオ要素を表示（既に block ならそのまま、none なら block にする）
      this.video.style.display = 'block';

      const canSupportWebKit =
        this.video.webkitSupportsPresentationMode &&
        this.video.webkitSupportsPresentationMode('picture-in-picture') &&
        typeof this.video.webkitSetPresentationMode === 'function';

      const canSupportStandard =
        document.pictureInPictureEnabled &&
        typeof this.video.requestPictureInPicture === 'function';

      if (canSupportWebKit) {
        this.video.webkitSetPresentationMode('picture-in-picture');

        // WebKitは同期的な変化を返すため、少し待機して実際の状態を確認する
        setTimeout(() => {
          if (this.video.webkitPresentationMode === 'picture-in-picture') {
            this.isActive = true;
            this.addLog('PiP開始成功 (WebKit)');
          } else {
            this.addLog('PiP開始失敗 (WebKit): webkitPresentationMode が変化しません');
          }
        }, 200);
      } else if (canSupportStandard) {
        await this.video.requestPictureInPicture();
        this.isActive = true;
        this.addLog('PiP開始成功 (Standard)');
      } else {
        this.addLog('PiP開始失敗: 対応するAPIが見つかりませんでした。');
      }
    } catch (e) {
      this.addLog(`PiP開始失敗: ${e.name} - ${e.message}`);
    }
  }

  stopPip() {
    if (this.video) {
      if (this.video.webkitPresentationMode === 'picture-in-picture') {
        this.video.webkitSetPresentationMode('inline');
      } else if (document.exitPictureInPicture) {
        document.exitPictureInPicture();
      }
      this.video.style.display = 'none';
    }
    this.isActive = false;
    this.addLog('PiP終了');
  }

  getIsActive() {
    return this.isActive;
  }

  addLog(msg) {
    const logBox = document.getElementById('log-box');
    if (logBox) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      logBox.appendChild(entry);
      logBox.scrollTop = logBox.scrollHeight;
    }
  }
}
