import { useState, useEffect, useCallback } from "react";

// Password vault. Entries are encrypted and decrypted on the server
// (/api/vault); the browser never holds an encryption key.
async function vaultApi(method, { id, body } = {}) {
  const url = id ? `/api/vault?id=${encodeURIComponent(id)}` : "/api/vault";
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "x-crm-request": "1", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Arguments are kept for compatibility; the server uses the signed-in session.
export default function useStorePassword(ci) {
  const [passwords, setPasswords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPasswords = useCallback(async () => {
    if (!ci) return [];
    setLoading(true);
    try {
      const { items } = await vaultApi("GET");
      setPasswords(items);
      setError(null);
      return items;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [ci]);

  useEffect(() => { fetchPasswords(); }, [fetchPasswords]);

  const addPassword = useCallback(async (data) => {
    try {
      setError(null);
      await vaultApi("POST", { body: { ...data, createdAt: data.createdAt || new Date().toISOString() } });
      await fetchPasswords();
    } catch (err) {
      setError(err.message);
    }
  }, [fetchPasswords]);

  const updatePassword = useCallback(async (id, data) => {
    try {
      setError(null);
      await vaultApi("PATCH", { id, body: data });
      await fetchPasswords();
    } catch (err) {
      setError(err.message);
    }
  }, [fetchPasswords]);

  const deletePassword = useCallback(async (id) => {
    try {
      setError(null);
      await vaultApi("DELETE", { id });
      setPasswords((list) => list.filter((p) => p.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  return { passwords, loading, error, addPassword, updatePassword, deletePassword, fetchPasswords };
}
