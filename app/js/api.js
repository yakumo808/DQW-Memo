// @ts-check
import { MemoRepository } from './api.js';

/**
 * LocalStorage を使用したメモデータのリポジトリ
 */
export const memoRepo = {
  getAll() {
    const raw = localStorage.getItem('dqw_memo_data');
    return raw ? JSON.parse(raw) : [];
  },

  save(memo) {
    const todos = this.getAll();
    const newMemo = {
      ...memo,
      id: Date.now().toString(),
      updated: new Date().toISOString()
    };
    todos.push(newMemo);
    localStorage.setItem('dqw_memo_data', JSON.stringify(todos));
    return newMemo;
  },

  getById(id) {
    const todos = this.getAll();
    return todos.find(m => m.id === id) || null;
  },

  update(id, updatedMemo) {
    const todos = this.getAll();
    const index = todos.findIndex(m => m.id === id);
    if (index !== -1) {
      todos[index] = { ...todos[index], ...updatedMemo, updated: new Date().toISOString() };
      localStorage.setItem('dqw_memo_data', JSON.stringify(todos));
      return todos[index];
    }
    return null;
  },

  delete(id) {
    const todos = this.getAll().filter(m => m.id !== id);
    localStorage.setItem('dqw_memo_data', JSON.stringify(todos));
    return true;
  }
};
