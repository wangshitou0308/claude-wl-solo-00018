// IndexedDB 本地持久化
// - kv：核对进行中的全部结构化数据（刷新后恢复未完成核对）
// - images：凭据图片 Blob（只存在本机浏览器，不上传任何服务器）

import type { AppState, StoredBlob } from '../types';

const DB_NAME = 'eyeglass-pickup-check';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const STORE_IMG = 'images';
const KV_KEY = 'app-state-v1';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
      if (!db.objectStoreNames.contains(STORE_IMG)) db.createObjectStore(STORE_IMG);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** 不入库的字段 */
function persistable(state: AppState): Omit<AppState, 'history'> {
  const { history: _history, ...rest } = state;
  void _history;
  return rest;
}

export async function saveState(state: AppState): Promise<void> {
  await tx(STORE_KV, 'readwrite', (s) => s.put(persistable(state), KV_KEY));
}

export async function loadState(): Promise<(Omit<AppState, 'history'> & { history?: AppState[] }) | null> {
  const v = await tx<unknown>(STORE_KV, 'readonly', (s) => s.get(KV_KEY));
  return (v as AppState | null) ?? null;
}

export async function clearState(): Promise<void> {
  await tx(STORE_KV, 'readwrite', (s) => s.delete(KV_KEY));
}

export async function putImage(id: string, blob: Blob): Promise<void> {
  await tx(STORE_IMG, 'readwrite', (s) => s.put(blob, id));
}

export async function getImage(id: string): Promise<StoredBlob | null> {
  const blob = await tx<Blob | undefined>(STORE_IMG, 'readonly', (s) => s.get(id));
  return blob ? { id, blob } : null;
}

export async function deleteImage(id: string): Promise<void> {
  await tx(STORE_IMG, 'readwrite', (s) => s.delete(id));
}

export async function clearImages(): Promise<void> {
  await tx(STORE_IMG, 'readwrite', (s) => s.clear());
}
