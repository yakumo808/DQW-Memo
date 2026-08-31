// @ts-check
import { MemoRepository } from './api.js';

/**
 * メモデータモデル
 */
export class Memo {
  constructor(id, title, content, updated = new Date()) {
    this.id = id;
    this.title = title;
    this.content = content;
    this.updated = updated;
  }
}
