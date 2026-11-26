// Holds the signed-in user's company/user ids for the browser.
//
// Pages used to read these ids from an AES-encrypted `?token=` URL parameter
// whose key was hard-coded in the source. Identity now comes only from the
// server session (/api/auth/me), and AuthContext stores it here before any
// protected page renders. `decryptToken` / `encryptToken` are kept as
// compatibility helpers so existing pages work unchanged: they no longer
// encrypt or decrypt anything and the URL no longer carries identity.
let current = { ci: null, aid: null };

export function setSessionIds(ids) {
  current = { ci: ids?.ci || null, aid: ids?.aid || null };
}

export function getSessionIds() {
  return { ...current };
}

// eslint-disable-next-line no-unused-vars
export function decryptToken(_ignored) {
  return { ...current };
}

// Navigation marker only; carries no data.
// eslint-disable-next-line no-unused-vars
export function encryptToken(_ci, _aid) {
  return 's';
}
