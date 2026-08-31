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
      this.canvas.style.display = 'none';
      this.video.style.display = 'none';
      this.video.muted = true;
      this.video.playsInline = true;
    }
  }

  init() {
    if (!this.canvas || !this.video || !this.ctx) return;
    this.canvas.width = 640;
    this.canvas.height = 320;
    this.stream = this.canvas.captureStream(30);
    this.video.srcObject = this.stream;
    this.addLog('PipRenderer: Canvas Stream 接続完了');
  }

  render(memo) {
    // 修正点: currentMemo が null の状態でも memo があれば描画処理へ進む
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
    if (!this.currentMemo || !this.video) return;
    
    try {
      await this.video.play();
      if (this.video.webkitSetPresentationMode) {
        this.video.webkitSetPresentationMode('picture-in-picture');
      } else if (this.video.requestPictureInPicture) {
        await this.video.requestPictureInPicture();
      }
      this.isActive = true;
      this.addLog('PiP開始成功');
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
