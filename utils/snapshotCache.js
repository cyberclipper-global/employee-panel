// Drop-in replacement for Firestore's onSnapshot that shares listeners.
//
// Many hooks subscribe to the same documents/collections (dashboard, sidebar
// counts, list pages). Each separate listener re-reads every document it
// matches, and each page change used to tear listeners down and start them
// again. Here, identical queries share one underlying listener, new
// subscribers get the latest snapshot immediately, and a listener is kept for
// a short grace period after the last subscriber leaves so navigating between
// pages does not re-read the same data.
import { onSnapshot as fsOnSnapshot, queryEqual, refEqual } from "firebase/firestore";

const GRACE_MS = 2 * 60 * 1000;
const entries = [];

function same(a, b) {
  if (a === b) return true;
  try {
    if (a.type === "document" && b.type === "document") return refEqual(a, b);
    if (a.type !== "document" && b.type !== "document") return queryEqual(a, b);
  } catch {
    return false;
  }
  return false;
}

function findEntry(target) {
  return entries.find((e) => same(e.target, target));
}

function startEntry(target) {
  const entry = { target, subscribers: new Set(), last: null, lastError: null, stopTimer: null, unsub: null };
  entry.unsub = fsOnSnapshot(
    target,
    (snap) => {
      entry.last = snap;
      entry.lastError = null;
      entry.subscribers.forEach((s) => { try { s.next(snap); } catch (err) { console.error(err); } });
    },
    (err) => {
      entry.lastError = err;
      entry.subscribers.forEach((s) => { if (s.error) s.error(err); });
      // A failed listener is dead; drop it so the next subscriber retries.
      const idx = entries.indexOf(entry);
      if (idx !== -1) entries.splice(idx, 1);
    }
  );
  entries.push(entry);
  return entry;
}

/**
 * Same call style as firebase/firestore onSnapshot(ref, next, error) or
 * onSnapshot(ref, { next, error }). Returns an unsubscribe function.
 * Snapshot-listen options (third object argument) bypass the cache.
 */
export function onSnapshot(target, a, b, c) {
  if (a && typeof a === "object" && typeof a.next !== "function") {
    // onSnapshot(ref, options, next, error): rarely used; not cached.
    return fsOnSnapshot(target, a, b, c);
  }
  const sub = typeof a === "function" ? { next: a, error: b } : { next: a.next.bind(a), error: a.error ? a.error.bind(a) : undefined };
  let entry = findEntry(target);
  if (!entry) entry = startEntry(target);
  if (entry.stopTimer) {
    clearTimeout(entry.stopTimer);
    entry.stopTimer = null;
  }
  entry.subscribers.add(sub);
  if (entry.last) {
    const snap = entry.last;
    Promise.resolve().then(() => { if (entry.subscribers.has(sub)) sub.next(snap); });
  }
  let done = false;
  return function unsubscribe() {
    if (done) return;
    done = true;
    entry.subscribers.delete(sub);
    if (entry.subscribers.size === 0 && !entry.stopTimer) {
      entry.stopTimer = setTimeout(() => {
        if (entry.subscribers.size > 0) return;
        try { entry.unsub(); } catch { /* ignore */ }
        const idx = entries.indexOf(entry);
        if (idx !== -1) entries.splice(idx, 1);
      }, GRACE_MS);
    }
  };
}

// Stops every cached listener (used on logout).
export function stopAllSnapshots() {
  while (entries.length) {
    const e = entries.pop();
    if (e.stopTimer) clearTimeout(e.stopTimer);
    try { e.unsub(); } catch { /* ignore */ }
  }
}
