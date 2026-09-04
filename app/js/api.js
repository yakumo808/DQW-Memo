/**
 * LocalStorage を使用したメモデータのリポジトリ
 */
export const MemoRepository = {
  STORAGE_KEY: 'dqw_memo_data',

  // 全メモの取得
  getAll: function() {
    const raw = localStorage.getItem(this.STORAGE_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('メモデータの読み込みに失敗しました', error);
      return [];
    }
  },

  // 新規作成
  save: function(memo) {
    const todos = this.getAll();
    const newMemo = {
      ...memo,
      id: Date.now().toString(),
      updated: new Date().toISOString()
    };
    todos.push(newMemo);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(todos));
    return newMemo;
  },

  // 特定のメモを取得
  getById: function(id) {
    const todos = this.getAll();
    return todos.find(function(m) { return m.id === id; }) || null;
  },

  // 更新
  update: function(id, updatedMemo) {
    const todos = this.getAll();
    const index = todos.findIndex(function(m) { return m.id === id; });
    if (index !== -1) {
      todos[index] = { ...todos[index], ...updatedMemo, updated: new Date().toISOString() };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(todos));
      return todos[index];
    }
    return null;
  },

  // 削除
  delete: function(id) {
    const todos = this.getAll().filter(function(m) { return m.id !== id; });
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(todos));
    return true;
  }
};
