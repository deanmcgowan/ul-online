import type { TransitStop } from "@/components/BusMap";

const LOCAL_STORAGE_FALLBACK_KEY = "ul-static-cache-snapshot";
const DB_NAME = "ul-online";
const STORE_NAME = "static-cache";
const SNAPSHOT_KEY = "snapshot";

export interface StaticDataSnapshot {
  hash: string;
  stops: TransitStop[];
  routeMap: Record<string, string>;
  stopRoutes: Record<string, string[]>;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function readFallbackSnapshot(): StaticDataSnapshot | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_FALLBACK_KEY);
    return raw ? (JSON.parse(raw) as StaticDataSnapshot) : null;
  } catch {
    return null;
  }
}

function writeFallbackSnapshot(snapshot: StaticDataSnapshot): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_FALLBACK_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore fallback cache failures.
  }
}

export async function loadStaticDataSnapshot(): Promise<StaticDataSnapshot | null> {
  if (!("indexedDB" in window)) {
    return readFallbackSnapshot();
  }

  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(SNAPSHOT_KEY);

      request.onsuccess = () => {
        const snapshot = (request.result as StaticDataSnapshot | undefined) ?? null;
        resolve(snapshot);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return readFallbackSnapshot();
  }
}

export async function saveStaticDataSnapshot(snapshot: StaticDataSnapshot): Promise<void> {
  if (!("indexedDB" in window)) {
    writeFallbackSnapshot(snapshot);
    return;
  }

  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      store.put(snapshot, SNAPSHOT_KEY);
    });
  } catch {
    writeFallbackSnapshot(snapshot);
  }
}