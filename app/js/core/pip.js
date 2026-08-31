// @ts-check
import { Memo } from './memo.js';

/**
 * PiP表示のための専用レンダリングエンジン
 */
export class PipRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private isActive = false;
  private currentMemo: Memo | null = null;
  private animationFrameId: number | null = null;

  constructor(canvasId: string, videoId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.video = document.getElementById(videoId) as HTMLVideoElement;
    this.ctx = this.canvas.getContext('2d')!;
    
    // 初期状態
    this.canvas.style.display = 'none';
    this.video.style.display = 'none';
    this.video.muted = true;
    this.video.playsInline = true;
  }

  /**
   * 描画の初期セットアップ
   */
  init() {
    this.canvas.width = 640;
    this.canvas.height = 320;
    this.stream = this.canvas.captureStream(30);
    this.video.srcObject = this.stream;
    this.addLog('PipRenderer: Canvas Stream 接続完了');
  }

  /**
   * メモ内容をCanvasに描画する
   * @param memo 保存されたメモオブジェクト
   */
  render(memo: Memo) {
    this.currentMemo = memo;
    this.draw(memo.content);
  }

  /**
   * Canvasへの描画ロジック（MVP仕様：読みやすさ重視）
   */
  private draw(text: string) {
    if (!this.currentMemo) return;

    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    // 背景描画
    ctx.fillStyle = '#1e1e24';
    ctx.fillRect(0, 0, w, h);

    // 枠
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);

    // タイトル領域
    ctx.fillStyle = '#2d2d3a';
    ctx.fillRect(6, 6, w - 12, 40);
    ctx.fillStyle = '#3b82f6';
    ctx.font = 'bold 20px "Yu Gothic UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.currentMemo.title || 'DQWメモ', w / 2 - 50, 25);

    // 本文領域
    ctx.fillStyle = '#f3f4f6';
    ctx.font = '20px "Yu Gothic UI", sans-serif';
    ctx.textBaseline = 'top';

    const lines = text.split('\n');
    let currentY = 60;
    const max_h = h - 80;

    lines.forEach((line) => {
      if (currentY + 38 > max_h) {
        // 簡易的な単語単位の折り返し
        const words = line.split(' ');
        let currentLine = '';
        for (let word of words) {
          if ((currentLine + word).length > 45) {
            ctx.fillText(currentLine, 30, currentY);
            currentY += 38;
            currentLine = word + ' ';
          } else {
            currentLine += word + ' ';
          }
        }
      } else {
        ctx.fillText(line, 30, currentY);
        currentY += 38;
      }
    });

    // フッター（更新情報）
    ctx.font = '14px "Yu Gothic UI", sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.fillText(`Updated: ${new Date().toLocaleTimeString()}`, 30, h - 15);
  }

  /**
   * PiPを開始する
   */
  async startPip() {
    if (!this.currentMemo) return;
    
    try {
      // ブラウザの自動再生ポリシーをクリアするため、一度playを呼ぶ
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

  /**
   * PiPを終了する
   */
  stopPip() {
    if (this.video.webkitPresentationMode === 'picture-in-picture') {
      this.video.webkitSetPresentationMode('inline');
    } else if (document.exitPictureInPicture) {
      document.exitPictureInPicture();
    }
    this.isActive = false;
    this.addLog('PiP終了');
  }

  getIsActive(): boolean {
    return this.isActive;
  }

  addLog(msg: string) {
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
