import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
// Firebase is loaded on demand so it is not part of the code every page
// (including the sign-in page) downloads first.
let fbPromise = null;
function loadFirebase() {
  if (!fbPromise) {
    fbPromise = Promise.all([import("firebase/auth"), import("../firebase")]).then(([m, f]) => ({ ...m, auth: f.auth }));
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
    import("../utils/snapshotCache").then((m) => m.stopAllSnapshots()).catch(() => {});
    try { await authApi("logout", { body: {} }); } catch { /* ignore */ }
    try { const { auth, signOut } = await loadFirebase(); await signOut(auth); } catch { /* ignore */ }
    setSessionIds(null);
    setUser(null);
    setError(null);
    router.push("/auth/login");
  }, [router]);

  // Loads the server session; returns true when signed in.
  const validateSession = useCallback(async () => {
    if (loadingRef.current) return loadingRef.current;
    loadingRef.current = (async () => {
      try {
        // Restoring the saved Firebase sign-in runs alongside the session
        // check, so a page reload does not need a new custom token.
        const [me] = await Promise.all([
          authApi("me", { method: "GET" }),
          loadFirebase().then(({ auth }) => (typeof auth.authStateReady === "function" ? auth.authStateReady() : null)).catch(() => {}),
        ]);
        // Firestore access in the browser needs this; the server session is
        // valid either way, so a Firebase problem (e.g. Authentication not
        // enabled in the project yet) must not sign the user out.
        try {
          await ensureFirebaseSignIn(me.firebaseUid);
        } catch (fbErr) {
          console.warn("Firebase sign-in failed:", fbErr?.code || fbErr?.message);
        }
        setSessionIds({ ci: me.user.companyId, aid: me.user.employeeId });
        setUser({ id: me.user.employeeId, ...me.user });
        setError(null);
        return true;
      } catch (err) {
        if (err.status && err.status !== 401) setError("Could not verify your session");
        setSessionIds(null);
        setUser(null);
        try { const { auth, signOut } = await loadFirebase(); await signOut(auth); } catch { /* ignore */ }
        return false;
      } finally {
        setLoading(false);
        loadingRef.current = null;
      }
    })();
    return loadingRef.current;
  }, [logout]);

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
    refreshSession: validateSession,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
