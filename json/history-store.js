// Formatting history. Kept in IndexedDB, where one entry can hold a
// multi-megabyte input (localStorage has about 5 MB for everything);
// entries saved in localStorage by older versions are moved over once.
// Where IndexedDB isn't available (some private modes) it falls back to
// localStorage, as before.
//
// Both stores have the same interface: list() gives the entries, most
// recent first ({ timestamp, preview, template, spec, fix, sort, ... });
// getInput(entry) the input text, which IndexedDB keeps apart so listing
// doesn't load every input; add(entry, input) saves one (an input formatted
// again just moves to the top) and resolves to false if it didn't fit;
// clear() empties it.

const DB_NAME = "jsonFormatter";
const LEGACY_KEY = "jsonFormatter.history";
// Inputs bigger than this aren't kept.
const MAX_INPUT_CHARS = 20000000;

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const committed = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error);
});

// FNV-1a, to find a repeated input without reading every stored one.
function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const newestFirst = (a, b) => b.timestamp - a.timestamp;

function openDb() {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore("entries", { keyPath: "id", autoIncrement: true });
    req.result.createObjectStore("inputs");
  };
  return done(req);
}

function indexedDbHistory(db, limit) {
  return {
    async list() {
      const entries = await done(db.transaction("entries").objectStore("entries").getAll());
      return entries.sort(newestFirst);
    },

    async getInput(entry) {
      return (await done(db.transaction("inputs").objectStore("inputs").get(entry.id))) ?? "";
    },

    async add(entry, input) {
      if (input.length > MAX_INPUT_CHARS) return false;
      const hash = hashText(input);
      const tx = db.transaction(["entries", "inputs"], "readwrite");
      const entries = tx.objectStore("entries");
      const inputs = tx.objectStore("inputs");
      try {
        const kept = [];
        for (const old of await done(entries.getAll())) {
          const same = old.hash === hash && old.size === input.length && (await done(inputs.get(old.id))) === input;
          if (same) {
            entries.delete(old.id);
            inputs.delete(old.id);
          } else {
            kept.push(old);
          }
        }
        kept.sort(newestFirst).slice(limit - 1).forEach((old) => {
          entries.delete(old.id);
          inputs.delete(old.id);
        });
        const id = await done(entries.add({ ...entry, hash, size: input.length }));
        inputs.put(input, id);
        await committed(tx);
        return true;
      } catch {
        // Quota exceeded, most likely; the transaction is rolled back.
        return false;
      }
    },

    async clear() {
      const tx = db.transaction(["entries", "inputs"], "readwrite");
      tx.objectStore("entries").clear();
      tx.objectStore("inputs").clear();
      await committed(tx);
    },
  };
}

function localStorageHistory(limit) {
  const load = () => {
    try {
      const entries = JSON.parse(localStorage.getItem(LEGACY_KEY));
      return Array.isArray(entries) ? entries : [];
    } catch {
      return [];
    }
  };
  const save = (entries) => {
    try {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(entries));
      return true;
    } catch {
      return false;
    }
  };
  return {
    async list() {
      return load();
    },
    async getInput(entry) {
      return entry.input;
    },
    // When storage is full the oldest entries are dropped; an input too big
    // to fit even alone is left out rather than wiping the rest.
    async add(entry, input) {
      const entries = [{ ...entry, input }, ...load().filter((e) => e.input !== input)].slice(0, limit);
      for (let n = entries.length; n > 1; n--) {
        if (save(entries.slice(0, n))) return true;
      }
      return save(entries.slice(0, 1));
    },
    async clear() {
      save([]);
    },
  };
}

// Moves entries saved by older versions (in localStorage) into `store`.
async function migrate(store) {
  const legacy = localStorageHistory(Infinity);
  const entries = await legacy.list();
  if (!entries.length) return;
  for (const { input, ...entry } of [...entries].reverse()) {
    if (typeof input === "string") await store.add(entry, input);
  }
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // storage unavailable; ignore
  }
}

export async function openHistory(limit) {
  try {
    const store = indexedDbHistory(await openDb(), limit);
    await migrate(store);
    return store;
  } catch {
    return localStorageHistory(limit);
  }
}
