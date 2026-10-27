import type { HistoryEvent } from './history';
import type { GameData } from './game-history';
import { isUnverifiedLegacyTrustEvent } from './trust-rank';

export interface HistoryStore {
  read(account: string): Promise<HistoryEvent[]>;
  append(account: string, events: HistoryEvent[]): Promise<void>;
  readGame(account: string): Promise<GameData>;
  saveGame(account: string, data: GameData): Promise<void>;
  clear(account: string): Promise<void>;
}

/** A versioned, append-only account partition. Upgrades never delete an existing store. */
export class IndexedHistoryStore implements HistoryStore {
  private database?: Promise<IDBDatabase>;
  private open() {
    if (!this.database) this.database = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('Локальная база данных недоступна.')); return; }
      const request = indexedDB.open('vrcnext-mobile-history', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('events')) {
          const store = db.createObjectStore('events', { keyPath: ['account', 'id'] });
          store.createIndex('accountTime', ['account', 'time']);
        }
        for (const name of ['visits', 'sessions']) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: ['account', 'id'] });
            store.createIndex('accountStart', ['account', 'start']);
          }
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
        .map(({ account: _account, ...event }) => event)
        .filter(event => !isUnverifiedLegacyTrustEvent(event)).reverse());
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
      const tx = db.transaction(['events', 'visits', 'sessions'], 'readwrite');
      const range = IDBKeyRange.bound([account, ''], [account, '\uffff']);
      for (const name of ['events', 'visits', 'sessions']) {
        const cursor = tx.objectStore(name).index(name === 'events' ? 'accountTime' : 'accountStart').openCursor(range);
        cursor.onsuccess = () => { const row = cursor.result; if (row) { row.delete(); row.continue(); } };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Не удалось удалить историю этого аккаунта.'));
      tx.onabort = () => reject(new Error('Удаление истории прервано.'));
    });
  }
  async readGame(account: string): Promise<GameData> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['visits', 'sessions'], 'readonly');
      const range = IDBKeyRange.bound([account, ''], [account, '\uffff']);
      const visits = tx.objectStore('visits').index('accountStart').getAll(range);
      const sessions = tx.objectStore('sessions').index('accountStart').getAll(range);
      tx.oncomplete = () => resolve({
        visits: (visits.result as (GameData['visits'][number] & { account: string })[]).map(({ account: _account, ...value }) => value).reverse(),
        sessions: (sessions.result as (GameData['sessions'][number] & { account: string })[]).map(({ account: _account, ...value }) => value).reverse(),
      });
      tx.onerror = () => reject(new Error('Не удалось прочитать журнал посещений.'));
      tx.onabort = () => reject(new Error('Чтение журнала посещений прервано.'));
    });
  }
  async saveGame(account: string, data: GameData): Promise<void> {
    if (!data.visits.length && !data.sessions.length) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['visits', 'sessions'], 'readwrite');
      for (const visit of data.visits) tx.objectStore('visits').put({ ...visit, account });
      for (const session of data.sessions) tx.objectStore('sessions').put({ ...session, account });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Не удалось сохранить журнал посещений. Проверьте свободную память.'));
      tx.onabort = () => reject(new Error('Сохранение журнала посещений прервано. Повторите попытку.'));
    });
  }
}

/** Only the explicit demo uses memory; failure of real storage is always visible. */
export class MemoryHistoryStore implements HistoryStore {
  private accounts = new Map<string, Map<string, HistoryEvent>>();
  private games = new Map<string, GameData>();
  async read(account: string) { return [...this.accounts.get(account)?.values() || []]
    .filter(event => !isUnverifiedLegacyTrustEvent(event)).sort((a,b) => b.time.localeCompare(a.time)); }
  async append(account: string, events: HistoryEvent[]) {
    let values = this.accounts.get(account);
    if (!values) { values = new Map(); this.accounts.set(account, values); }
    for (const event of events) values.set(event.id, event);
  }
  async readGame(account: string): Promise<GameData> { return structuredClone(this.games.get(account) || { visits: [], sessions: [] }); }
  async saveGame(account: string, data: GameData) {
    const previous = this.games.get(account) || { visits: [], sessions: [] };
    this.games.set(account, structuredClone({
      visits: [...new Map([...previous.visits, ...data.visits].map((v) => [v.id, v])).values()],
      sessions: [...new Map([...previous.sessions, ...data.sessions].map((s) => [s.id, s])).values()],
    }));
  }
  async clear(account: string) { this.accounts.delete(account); this.games.delete(account); }
}
