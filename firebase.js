// Import the functions you need from the SDKs you need
import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore, initializeFirestore, connectFirestoreEmulator,
  persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  terminate, clearIndexedDbPersistence,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { EMPLOYEE_FIREBASE_CONFIG } from "./lib/firebaseProject";

// Your web app's Firebase configuration (project employee-27679)
const firebaseConfig = EMPLOYEE_FIREBASE_CONFIG;

// Initialize Firebase only if it hasn't been initialized already
let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}


// Firestore keeps a copy of what this browser has already read (IndexedDB),
// so pages show their data immediately and update from the server in the
// background. Cleared on logout (clearLocalData below).
function createDb() {
  if (typeof window === "undefined") return getFirestore(app);
  if (globalThis.__ccDb) return globalThis.__ccDb;
  let instance;
  try {
    instance = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    try { instance = initializeFirestore(app, { localCache: memoryLocalCache() }); } catch { instance = getFirestore(app); }
  }
  globalThis.__ccDb = instance;
  return instance;
}
const db = createDb();

// Removes the browser's copy of Firestore data (used on logout).
export async function clearLocalData() {
  try { await terminate(db); } catch { /* ignore */ }
  try { await clearIndexedDbPersistence(db); } catch { /* ignore */ }
}
const storage = getStorage(app);

// Signed in with a server-issued custom token (see context/AuthContext.jsx);
// Firestore security rules rely on its claims.
const auth = getAuth(app);

// Local testing only: NEXT_PUBLIC_FIREBASE_EMULATOR=1 points the browser at
// the Firebase emulators. Never set it in production.
if (process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === "1" && typeof window !== "undefined" && !globalThis.__ccEmulatorsConnected) {
  globalThis.__ccEmulatorsConnected = true;
  connectFirestoreEmulator(db, "127.0.0.1", Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT || 8085));
  connectAuthEmulator(auth, `http://127.0.0.1:${process.env.NEXT_PUBLIC_AUTH_EMULATOR_PORT || 9099}`, { disableWarnings: true });
}

// Export the Firebase services
export { db, storage, app, auth };
