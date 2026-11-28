import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
// Firebase is loaded on demand so it is not part of the code every page
// (including the sign-in page) downloads first.
let fbPromise = null;
function loadFirebase() {
  if (!fbPromise) {
    fbPromise = Promise.all([import("firebase/auth"), import("../firebase")]).then(([m, f]) => ({ ...m, auth: f.auth, clearLocalData: f.clearLocalData }));
  }
  return fbPromise;
}
import { setSessionIds } from "../utils/session";

// Identity comes from the server: the HttpOnly `employeeSession` cookie is
// set by /api/auth/* after password (and 2FA when enabled). The browser then signs in to
// Firebase with a short-lived custom token so Firestore security rules can
// check which company it belongs to.
const AuthContext = createContext();

const PUBLIC_ROUTES = new Set(["/", "/auth/login", "/auth/signup", "/privacy", "/terms"]);

async function authApi(action, { method = "POST", body } = {}) {
  const res = await fetch(`/api/auth/${action}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "x-crm-request": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export { authApi };

// The last confirmed session, so a reload can show the panel straight away
// while the server check runs in the background. It holds only display
// details; every read and write is still checked by the server and by the
// Firestore rules.
const CACHE_KEY = "cc_emp_me";
function readCachedMe() {
  try { return JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
}
function writeCachedMe(me) {
  try {
    if (me) window.localStorage.setItem(CACHE_KEY, JSON.stringify({ user: me.user, firebaseUid: me.firebaseUid }));
    else window.localStorage.removeItem(CACHE_KEY);
  } catch { /* storage unavailable */ }
}
const stopAllSnapshots = () => import("../utils/snapshotCache").then((m) => m.stopAllSnapshots()).catch(() => {});

async function ensureFirebaseSignIn(expectedUid) {
  const { auth, signInWithCustomToken } = await loadFirebase();
  if (auth.currentUser && auth.currentUser.uid === expectedUid) return;
  const { token } = await authApi("firebase-token", { body: {} });
  await signInWithCustomToken(auth, token);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();
  const loadingRef = useRef(null);

  const logout = useCallback(async () => {
    stopAllSnapshots();
    writeCachedMe(null);
    try { window.localStorage.removeItem("cc_emp_profile"); } catch { /* ignore */ }
    try { await authApi("logout", { body: {} }); } catch { /* ignore */ }
    try { const { auth, signOut } = await loadFirebase(); await signOut(auth); } catch { /* ignore */ }
    setSessionIds(null);
    setUser(null);
    setError(null);
    // Firestore cannot be used after its local copy is cleared, so load the
    // login page fresh.
    try { const { clearLocalData } = await loadFirebase(); await clearLocalData(); } catch { /* ignore */ }
    window.location.assign("/auth/login");
  }, []);

  const applyMe = useCallback((me) => {
    setSessionIds({ ci: me.user.companyId, aid: me.user.employeeId });
    setUser((prev) => {
      const next = { id: me.user.employeeId, ...me.user };
      return prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
    setError(null);
  }, []);

  const signedOut = useCallback(async (err) => {
    if (err?.status && err.status !== 401) setError("Could not verify your session");
    writeCachedMe(null);
    stopAllSnapshots();
    setSessionIds(null);
    setUser(null);
    try { const { auth, signOut } = await loadFirebase(); await signOut(auth); } catch { /* ignore */ }
  }, []);

  // Loads the server session; returns true when signed in.
  // fresh: skip the instant path (used right after signing in).
  const validateSession = useCallback(async ({ fresh = false } = {}) => {
    if (loadingRef.current && !fresh) return loadingRef.current;
    loadingRef.current = (async () => {
      const cached = fresh ? null : readCachedMe();
      const mePromise = authApi("me", { method: "GET" });
      mePromise.catch(() => {}); // handled below
      // Fast path: the browser still holds the Firebase sign-in for the same
      // account as last time -> show the panel now, confirm in the background.
      if (cached?.user?.companyId && cached.firebaseUid) {
        let auth = null;
        try {
          ({ auth } = await loadFirebase());
          if (typeof auth.authStateReady === "function") await auth.authStateReady();
        } catch { /* ignore */ }
        if (auth && auth.currentUser && auth.currentUser.uid === cached.firebaseUid) {
          applyMe(cached);
          setLoading(false);
          mePromise.then(async (me) => {
            if (me.firebaseUid !== cached.firebaseUid) {
              // Rare: the server session belongs to another account now.
              writeCachedMe(null);
              try { await ensureFirebaseSignIn(me.firebaseUid); } catch { /* ignore */ }
              let reloadedRecently = false;
              try {
                reloadedRecently = Date.now() - Number(window.sessionStorage.getItem("cc_emp_reload") || 0) < 30000;
                window.sessionStorage.setItem("cc_emp_reload", String(Date.now()));
              } catch { /* ignore */ }
              if (!reloadedRecently) window.location.reload();
              else applyMe(me);
              return;
            }
            writeCachedMe(me);
            applyMe(me);
          }).catch(async (err) => {
            if (err.status === 401 || err.status === 403) await signedOut(err);
            // Network errors: keep the page; the next navigation checks again.
          }).finally(() => { loadingRef.current = null; });
          return true;
        }
      }
      try {
        // Restoring the saved Firebase sign-in runs alongside the session
        // check, so a page reload does not need a new custom token.
        const [me] = await Promise.all([
          mePromise,
          loadFirebase().then(({ auth }) => (typeof auth.authStateReady === "function" ? auth.authStateReady() : null)).catch(() => {}),
        ]);
        // Firestore access in the browser needs this; the server session is
        // valid either way, so a Firebase problem (e.g. Authentication not
        // enabled in the project yet) must not sign the user out.
        let firebaseOk = true;
        try {
          await ensureFirebaseSignIn(me.firebaseUid);
        } catch (fbErr) {
          firebaseOk = false;
          console.warn("Firebase sign-in failed:", fbErr?.code || fbErr?.message);
        }
        // Only remember the session for the instant path when Firebase sign-in works.
        writeCachedMe(firebaseOk ? me : null);
        applyMe(me);
        return true;
      } catch (err) {
        await signedOut(err);
        return false;
      } finally {
        setLoading(false);
        loadingRef.current = null;
      }
    })();
    return loadingRef.current;
  }, [applyMe, signedOut]);

  useEffect(() => {
    if (PUBLIC_ROUTES.has(router.pathname)) {
      setLoading(false);
      return;
    }
    if (!user) validateSession();
  }, [router.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = {
    user,
    loading,
    error,
    logout,
    validateSession,
    refreshSession: () => validateSession({ fresh: true }),
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
