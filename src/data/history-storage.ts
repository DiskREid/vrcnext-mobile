import type { HistoryEvent } from './history';

export interface HistoryStore {
  read(account: string): Promise<HistoryEvent[]>;
  append(account: string, events: HistoryEvent[]): Promise<void>;
  clear(account: string): Promise<void>;
}

/** A versioned, append-only account partition. Upgrades never delete an existing store. */
export class IndexedHistoryStore implements HistoryStore {
  private database?: Promise<IDBDatabase>;
  private open() {
    if (!this.database) this.database = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('Локальная база данных недоступна.')); return; }
      const request = indexedDB.open('vrcnext-mobile-history', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('events')) {
          const store = db.createObjectStore('events', { keyPath: ['account', 'id'] });
          store.createIndex('accountTime', ['account', 'time']);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.database = undefined; };
        resolve(db);
      };
      request.onerror = () => { this.database = undefined; reject(new Error('Не удалось открыть локальную историю.')); };
      request.onblocked = () => { this.database = undefined; reject(new Error('Закройте другие окна приложения и повторите открытие истории.')); };
    });
    return this.database;
  }
  async read(account: string): Promise<HistoryEvent[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readonly');
      const range = IDBKeyRange.bound([account, ''], [account, '\uffff']);
      const request = tx.objectStore('events').index('accountTime').getAll(range);
      request.onsuccess = () => resolve((request.result as (HistoryEvent & { account: string })[])
        .map(({ account: _account, ...event }) => event).reverse());
      request.onerror = () => reject(new Error('Не удалось прочитать локальную историю.'));
      tx.onabort = () => reject(new Error('Чтение истории прервано.'));
    });
  }
  async append(account: string, events: HistoryEvent[]): Promise<void> {
    if (!events.length) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readwrite');
      for (const event of events) tx.objectStore('events').put({ ...event, account });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Не удалось сохранить историю. Возможно, память устройства заполнена.'));
      tx.onabort = () => reject(new Error('Сохранение истории прервано. Повторите попытку.'));
    });
  }
  async clear(account: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readwrite');
      const range = IDBKeyRange.bound([account, ''], [account, '\uffff']);
      const cursor = tx.objectStore('events').index('accountTime').openCursor(range);
      cursor.onsuccess = () => { const row = cursor.result; if (row) { row.delete(); row.continue(); } };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Не удалось удалить историю этого аккаунта.'));
      tx.onabort = () => reject(new Error('Удаление истории прервано.'));
    });
  }
}

/** Only the explicit demo uses memory; failure of real storage is always visible. */
export class MemoryHistoryStore implements HistoryStore {
  private accounts = new Map<string, Map<string, HistoryEvent>>();
  async read(account: string) { return [...this.accounts.get(account)?.values() || []].sort((a,b) => b.time.localeCompare(a.time)); }
  async append(account: string, events: HistoryEvent[]) {
    let values = this.accounts.get(account);
    if (!values) { values = new Map(); this.accounts.set(account, values); }
    for (const event of events) values.set(event.id, event);
  }
  async clear(account: string) { this.accounts.delete(account); }
}
