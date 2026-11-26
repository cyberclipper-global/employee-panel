// Import the functions you need from the SDKs you need
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";
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

// Only initialize analytics in the browser
let analytics;
if (typeof window !== "undefined") {
  try {
    analytics = getAnalytics(app);
  } catch (error) {
    console.log("Analytics initialization failed:", error);
  }
}

// Initialize Firestore and Storage
const db = getFirestore(app);
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
