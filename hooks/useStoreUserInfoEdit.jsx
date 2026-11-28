import React, { useState, useCallback, useMemo } from 'react';
// Firestore is loaded on demand (keeps it out of the first-load bundle).
const loadFs = () => Promise.all([import('firebase/firestore'), import('../firebase')]).then(([m, f]) => ({ ...m, db: f.db }));
import { useAuth } from '../context/AuthContext';

// Profile built from the sign-in session, used when the profile document
// cannot be read (e.g. the employee database is still being set up).
function sessionProfile(s) {
  if (!s) return null;
  const [firstName, ...rest] = String(s.name || '').split(' ');
  return {
    id: s.employeeId,
    firstName: firstName || '',
    lastName: rest.join(' '),
    name: s.name || '',
    email: s.email || '',
    role: s.role || '',
    company: s.companyName || '',
    profileIncomplete: true,
  };
}

// The employee's own profile is shown from the last saved copy straight
// away and refreshed from the database in the background.
const PROFILE_KEY = 'cc_emp_profile';
function readProfile(cid, aid) {
  if (!cid || !aid || typeof window === 'undefined') return null;
  try {
    const p = JSON.parse(window.localStorage.getItem(PROFILE_KEY) || 'null');
    return p && p.cid === cid && p.aid === aid ? p.user : null;
  } catch { return null; }
}
function writeProfile(cid, aid, user) {
  try {
    if (user) window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ cid, aid, user }));
    else window.localStorage.removeItem(PROFILE_KEY);
  } catch { /* storage unavailable */ }
}

export default function useStoreUserInfoEdit(cid, aid) {
  const { user: sessionUser } = useAuth();
  const sessionRef = React.useRef(sessionUser);
  sessionRef.current = sessionUser;
  const [user, setUserState] = useState(() => readProfile(cid, aid));
  const [loading, setLoading] = useState(false);
  // Only the signed-in employee's own profile is saved in the browser.
  const isOwn = !!(sessionUser && sessionUser.employeeId === aid && sessionUser.companyId === cid);
  const setUser = useCallback((next) => {
    setUserState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      if (isOwn && value && !value.profileIncomplete) writeProfile(cid, aid, value);
      return value;
    });
  }, [isOwn, cid, aid]);
  React.useEffect(() => {
    const cached = readProfile(cid, aid);
    if (cached) setUserState((prev) => (prev && prev.id === aid ? prev : cached));
  }, [cid, aid]);
  const [error, setError] = useState(null);

  // Memoize the parameters to prevent unnecessary re-renders
  const memoizedCid = useMemo(() => cid, [cid]);
  const memoizedAid = useMemo(() => aid, [aid]);

  // Fetch user data by cid and aid
  const fetchUser = useCallback(async () => {
    if (!memoizedCid || !memoizedAid) {
      return;
    }

    const hasCopy = !!readProfile(memoizedCid, memoizedAid);
    if (!hasCopy) setLoading(true);
    setError(null);
    try {
      const { doc, getDoc, db } = await loadFs();
      const userRef = doc(db, 'users', memoizedCid, 'employees', memoizedAid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const userData = { id: userSnap.id, ...userSnap.data() };
        setUser(userData);
        return;
      }
      throw new Error('User not found');
    } catch (err) {
      const own = sessionRef.current && sessionRef.current.employeeId === memoizedAid && sessionRef.current.companyId === memoizedCid;
      if (own) {
        // Signed-in employee: keep the app usable with the session details.
        console.warn('Profile not readable, using session details:', err.message);
        if (!hasCopy) setUser(sessionProfile(sessionRef.current));
      } else {
        setError(err.message);
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, [memoizedCid, memoizedAid, setUser]);

  // Update all fields at once
  const updateAllFields = useCallback(async (fields) => {
    if (!memoizedCid || !memoizedAid) return;
    setLoading(true);
    setError(null);
    try {
      const { doc, updateDoc, db } = await loadFs();
      const userRef = doc(db, 'users', memoizedCid, 'employees', memoizedAid);
      await updateDoc(userRef, fields);
      setUser((prev) => prev ? { ...prev, ...fields } : prev);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [memoizedCid, memoizedAid]);

  // Memoize the return value to prevent unnecessary re-renders
  const result = useMemo(() => ({
    user,
    setUser,
    loading,
    error,
    fetchUser,
    updateAllFields,
  }), [user, loading, error, fetchUser, updateAllFields]);

  return result;
}