/* ============================================================
   db.js — IndexedDB 封装
   数据全部保存在本设备浏览器本地，不上传任何服务器。
   ============================================================ */

const DB_NAME = 'inventory-app';
const DB_VERSION = 2;

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('parts')) {
        const s = db.createObjectStore('parts', { keyPath: 'id' });
        s.createIndex('sku', 'sku', { unique: false });
      }
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('transactions')) {
        const s = db.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('time', 'time', { unique: false });
      }
      if (!db.objectStoreNames.contains('forecast')) {
        db.createObjectStore('forecast', { keyPath: 'productId' });
      }
      if (!db.objectStoreNames.contains('plans')) {
        const s = db.createObjectStore('plans', { keyPath: 'id' });
        s.createIndex('date', 'date', { unique: false });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async all(store) {
    const s = await tx(store, 'readonly');
    return reqToPromise(s.getAll());
  },
  async get(store, id) {
    const s = await tx(store, 'readonly');
    return reqToPromise(s.get(id));
  },
  async put(store, obj) {
    const s = await tx(store, 'readwrite');
    return reqToPromise(s.put(obj));
  },
  async del(store, id) {
    const s = await tx(store, 'readwrite');
    return reqToPromise(s.delete(id));
  },
  async clear(store) {
    const s = await tx(store, 'readwrite');
    return reqToPromise(s.clear());
  },
  async bulkPut(store, arr) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      arr.forEach(o => s.put(o));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async bulkClear(stores) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, 'readwrite');
      stores.forEach(name => t.objectStore(name).clear());
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
