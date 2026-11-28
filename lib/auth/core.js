// Login engine shared by the admin and employee panels: email + one-time code.
//
//   1. POST request-otp { email }   -> a 6-digit code is emailed (if an account uses that email)
//   2. POST verify-otp  { challenge, code } -> session cookie
//      (if the email belongs to more than one company/account, the user picks one)
//   or POST pin-login   { email, pin }      -> session cookie, when the account
//      has a sign-in PIN (set while signed in, confirmed with an emailed code).
//
// Codes are stored hashed, expire after 10 minutes, allow 5 attempts and are
// single-use. Sessions are HttpOnly signed cookies; every request re-checks
// the account's session version, so an admin can sign a user out everywhere.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getCrmDb, FieldValue } from '../crm/firestore';
import { CrmError } from '../crm/errors';
import { rateLimit, clientIp, readCookie } from '../crm/http';
import { codeHash, safeEqualHex, randomDigits, hashPin, checkPin } from './secrets';
import { sendVerificationCode } from './mailer';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const CHALLENGE_TTL = 10 * 60;
const PIN_RE = /^\d{6,8}$/;
const MAX_PIN_FAILS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]{2,}$/;
// How long a session check may be served from memory (sign-out-everywhere
// takes effect within this time).
const SESSION_CACHE_MS = Number(process.env.AUTH_SESSION_CACHE_MS ?? 30000);

export const authError = (status, message, code) => new CrmError(status, message, code);

export function normalizeEmail(email) {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(e) || e.length > 254) throw authError(400, 'Enter a valid email address', 'bad_email');
  return e;
}

export function accountId(kind, companyId, employeeId = '') {
  return crypto.createHash('sha256').update(`${kind}:${companyId}:${employeeId}`).digest('hex').slice(0, 40);
}

const accountsCol = () => getCrmDb().collection('authAccounts');
const otpDoc = (kind, email) => getCrmDb().collection('authOtp').doc(crypto.createHash('sha256').update(`${kind}:${email}`).digest('hex').slice(0, 40));

export async function getAccount(id) {
  const snap = await accountsCol().doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function updateAccount(id, data) {
  await accountsCol().doc(id).set({ ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

function cookieAttrs(maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function createAuth(config) {
  // config: { kind, appName, cookieName, sessionTtlSeconds, secret(),
  //   findByEmail(email) -> principals[], resolvePrincipal(ids) -> principal|null,
  //   sessionClaims(p), idsFromSession(payload), firebase: { auth(), uid(p), claims(p) } }
  const challengeAud = `cc-otp-${config.kind}`;
  const selectAud = `cc-select-${config.kind}`;
  const sessionAud = `cc-session-${config.kind}`;
  const versionCache = new Map();
  const idsOf = (p) => ({ companyId: p.companyId, employeeId: p.employeeId || '' });

  async function issueSession(res, principal) {
    const id = accountId(config.kind, principal.companyId, principal.employeeId || '');
    const account = (await getAccount(id)) || {};
    const token = jwt.sign({ ...config.sessionClaims(principal), sv: account.sessionVersion || 0 }, config.secret(), {
      algorithm: 'HS256', audience: sessionAud, expiresIn: config.sessionTtlSeconds,
    });
    res.setHeader('Set-Cookie', `${config.cookieName}=${token}; ${cookieAttrs(config.sessionTtlSeconds)}`);
    await updateAccount(id, { lastLoginAt: Date.now(), kind: config.kind, companyId: principal.companyId, employeeId: principal.employeeId || null });
    return { next: 'done' };
  }

  function clearSession(res) {
    res.setHeader('Set-Cookie', `${config.cookieName}=; ${cookieAttrs(0)}`);
  }

  // Step 1: email a code. Unless config.unknownEmailMessage is set, the
  // response is the same whether or not the email belongs to an account.
  async function requestOtp(req) {
    rateLimit(`otp-ip:${config.kind}:${clientIp(req)}`, 20, 15 * 60 * 1000);
    const email = normalizeEmail(req.body?.email);
    rateLimit(`otp-email:${config.kind}:${email}`, 5, 15 * 60 * 1000);
    const challenge = jwt.sign({ em: email }, config.secret(), { algorithm: 'HS256', audience: challengeAud, expiresIn: CHALLENGE_TTL });
    const generic = { ok: true, challenge, message: 'If this email is registered, a 6-digit code has been sent to it.' };
    const principals = await config.findByEmail(email);
    if (!principals.length) {
      // The admin panel tells the person plainly that this email has no access
      // (config.unknownEmailMessage). Without it the answer stays generic.
      if (config.unknownEmailMessage) throw authError(403, config.unknownEmailMessage, 'no_access');
      return generic;
    }
    const code = randomDigits(6);
    await otpDoc(config.kind, email).set({
      hash: codeHash(`${config.kind}:${email}:${code}`),
      expiresAt: Date.now() + CODE_TTL_MS,
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
    });
    try {
      await sendVerificationCode({ to: email, code, appName: config.appName });
    } catch (err) {
      console.error('[auth] could not send the sign-in code:', err.code || err.message);
      throw authError(503, 'Could not send the email. Please try again in a few minutes.', 'email_failed');
    }
    return generic;
  }

  // Checks an emailed code for this email; single use, 5 attempts.
  async function consumeCode(email, rawCode) {
    const ref = otpDoc(config.kind, email);
    const code = String(rawCode || '').trim();
    let ok = false;
    await getCrmDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : null;
      if (!d || d.expiresAt < Date.now() || d.attempts >= MAX_CODE_ATTEMPTS) return;
      if (/^\d{6}$/.test(code) && safeEqualHex(codeHash(`${config.kind}:${email}:${code}`), d.hash)) {
        ok = true;
        tx.delete(ref); // single use
      } else {
        tx.update(ref, { attempts: (d.attempts || 0) + 1 });
      }
    });
    return ok;
  }

  function readChallenge(raw) {
    try {
      return jwt.verify(String(raw || ''), config.secret(), { algorithms: ['HS256'], audience: challengeAud });
    } catch {
      throw authError(401, 'The code has expired. Request a new one.', 'expired');
    }
  }

  // After a successful check: sign in, or ask which account to use.
  function signInOrChoose(res, email, principals) {
    if (principals.length === 1) return issueSession(res, principals[0]);
    const selection = jwt.sign({ em: email, ids: principals.map(idsOf) }, config.secret(), { algorithm: 'HS256', audience: selectAud, expiresIn: 5 * 60 });
    return {
      next: 'choose',
      selection,
      accounts: principals.map((p, i) => ({ index: i, label: p.accountLabel || p.companyId })),
    };
  }

  // Step 2: check the code, then sign in (or ask which account to use).
  async function verifyOtp(req, res) {
    rateLimit(`otp-verify:${config.kind}:${clientIp(req)}`, 60, 15 * 60 * 1000);
    let payload;
    try {
      payload = jwt.verify(String(req.body?.challenge || ''), config.secret(), { algorithms: ['HS256'], audience: challengeAud });
    } catch {
      throw authError(401, 'The code has expired. Request a new one.', 'expired');
    }
    const email = payload.em;
    const ok = await consumeCode(email, req.body?.code);
    if (!ok) throw authError(401, 'The code is not correct or has expired', 'bad_code');
    const principals = await config.findByEmail(email);
    if (!principals.length) throw authError(401, 'This email is not registered', 'unknown');
    return signInOrChoose(res, email, principals);
  }

  // ---- Sign-in PIN -------------------------------------------------------
  // The PIN is stored only as a salted, slow hash in authAccounts (which the
  // browser can never read). 5 wrong PINs lock PIN sign-in for 15 minutes;
  // the emailed code always keeps working.
  function validatePin(pin) {
    const p = String(pin || '');
    if (!PIN_RE.test(p)) throw authError(400, 'The PIN must be 6 to 8 digits', 'bad_pin');
    if (/^(\d)\1+$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p)) {
      throw authError(400, 'This PIN is too easy to guess. Avoid repeated or sequential digits.', 'weak_pin');
    }
    return p;
  }

  async function pinStatus(req) {
    const { principal } = await requireSession(req);
    const account = (await getAccount(accountId(config.kind, principal.companyId, principal.employeeId || ''))) || {};
    return { hasPin: !!account.pinHash, pinSetAt: account.pinSetAt || null, email: principal.email };
  }

  // Setting or changing the PIN needs the signed-in session AND a code
  // emailed to the account's address (request it with request-otp first).
  async function setPin(req) {
    const { principal } = await requireSession(req);
    rateLimit(`pin-set:${config.kind}:${principal.companyId}:${principal.employeeId || ''}`, 10, 15 * 60 * 1000);
    const pin = validatePin(req.body?.pin);
    const payload = readChallenge(req.body?.challenge);
    if (!principal.email || payload.em !== principal.email) throw authError(400, 'Request a code for your own email first', 'bad_challenge');
    if (!(await consumeCode(payload.em, req.body?.code))) throw authError(401, 'The code is not correct or has expired', 'bad_code');
    const id = accountId(config.kind, principal.companyId, principal.employeeId || '');
    await updateAccount(id, {
      pinHash: await hashPin(pin), pinSetAt: Date.now(), pinFails: 0, pinLockedUntil: 0,
      kind: config.kind, companyId: principal.companyId, employeeId: principal.employeeId || null,
    });
    return { ok: true, hasPin: true };
  }

  async function removePin(req) {
    const { principal } = await requireSession(req);
    const id = accountId(config.kind, principal.companyId, principal.employeeId || '');
    await updateAccount(id, { pinHash: FieldValue.delete(), pinSetAt: FieldValue.delete(), pinFails: 0, pinLockedUntil: 0 });
    return { ok: true, hasPin: false };
  }

  async function pinLogin(req, res) {
    rateLimit(`pin-ip:${config.kind}:${clientIp(req)}`, 30, 15 * 60 * 1000);
    const email = normalizeEmail(req.body?.email);
    rateLimit(`pin-email:${config.kind}:${email}`, 10, 15 * 60 * 1000);
    const pin = String(req.body?.pin || '');
    const principals = await config.findByEmail(email);
    if (!principals.length) {
      if (config.unknownEmailMessage) throw authError(403, config.unknownEmailMessage, 'no_access');
      throw authError(401, 'The email or PIN is not correct', 'bad_pin');
    }
    const now = Date.now();
    const withPin = [];
    for (const p of principals) {
      const id = accountId(config.kind, p.companyId, p.employeeId || '');
      const account = (await getAccount(id)) || {};
      if (account.pinHash) withPin.push({ p, id, account });
    }
    if (!withPin.length) {
      throw authError(400, 'No PIN is set for this account yet. Sign in with an email code, then set a PIN in Passwords & Security.', 'no_pin');
    }
    const open = withPin.filter((a) => !(a.account.pinLockedUntil > now));
    if (!open.length) {
      const until = Math.max(...withPin.map((a) => a.account.pinLockedUntil));
      const mins = Math.max(1, Math.ceil((until - now) / 60000));
      throw authError(429, `Too many wrong PINs. PIN sign-in is locked for ${mins} more minute${mins === 1 ? '' : 's'}. You can still sign in with an email code.`, 'pin_locked');
    }
    const matched = [];
    for (const a of open) {
      if (PIN_RE.test(pin) && (await checkPin(pin, a.account.pinHash))) matched.push(a);
    }
    if (!matched.length) {
      let left = MAX_PIN_FAILS;
      for (const a of open) {
        const fails = (a.account.pinFails || 0) + 1;
        const locked = fails >= MAX_PIN_FAILS;
        await updateAccount(a.id, { pinFails: locked ? 0 : fails, pinLockedUntil: locked ? now + PIN_LOCK_MS : 0 });
        left = Math.min(left, locked ? 0 : MAX_PIN_FAILS - fails);
      }
      if (left <= 0) throw authError(429, 'Too many wrong PINs. PIN sign-in is locked for 15 minutes. You can still sign in with an email code.', 'pin_locked');
      throw authError(401, `The PIN is not correct. ${left} attempt${left === 1 ? '' : 's'} left.`, 'bad_pin');
    }
    for (const a of matched) {
      if (a.account.pinFails || a.account.pinLockedUntil) await updateAccount(a.id, { pinFails: 0, pinLockedUntil: 0 });
    }
    return signInOrChoose(res, email, matched.map((a) => a.p));
  }

  // Step 2b: the email belongs to several accounts; the user picks one.
  async function selectAccount(req, res) {
    let payload;
    try {
      payload = jwt.verify(String(req.body?.selection || ''), config.secret(), { algorithms: ['HS256'], audience: selectAud });
    } catch {
      throw authError(401, 'This step has expired. Please sign in again.', 'expired');
    }
    const chosen = payload.ids[Number(req.body?.index)];
    if (!chosen) throw authError(400, 'Choose an account', 'bad_choice');
    const principal = await config.resolvePrincipal(chosen);
    if (!principal || String(principal.email || '').toLowerCase() !== payload.em) throw authError(401, 'This account is no longer available', 'unknown');
    return issueSession(res, principal);
  }

  async function requireSession(req) {
    const token = readCookie(req, config.cookieName);
    if (!token) throw authError(401, 'Please sign in', 'unauthorized');
    let payload;
    try {
      payload = jwt.verify(token, config.secret(), { algorithms: ['HS256'], audience: sessionAud });
    } catch {
      throw authError(401, 'Your session has expired. Please sign in again.', 'unauthorized');
    }
    const ids = config.idsFromSession(payload);
    if (!ids) throw authError(401, 'Please sign in', 'unauthorized');
    const id = accountId(config.kind, ids.companyId, ids.employeeId || '');
    const hit = versionCache.get(id);
    let state = hit && hit.expires > Date.now() ? hit.value : null;
    if (!state) {
      const [account, principal] = await Promise.all([getAccount(id), config.resolvePrincipal(ids)]);
      state = { sv: account?.sessionVersion || 0, principal };
      versionCache.set(id, { value: state, expires: Date.now() + SESSION_CACHE_MS });
      if (versionCache.size > 5000) versionCache.clear();
    }
    if (!state.principal || state.sv !== (payload.sv || 0)) {
      throw authError(401, 'Your session is no longer valid. Please sign in again.', 'unauthorized');
    }
    return { principal: state.principal, payload };
  }

  async function firebaseToken(req) {
    const { principal } = await requireSession(req);
    const token = await config.firebase.auth().createCustomToken(config.firebase.uid(principal), config.firebase.claims(principal));
    return { token, uid: config.firebase.uid(principal) };
  }

  return { requestOtp, verifyOtp, selectAccount, requireSession, firebaseToken, clearSession, pinStatus, setPin, removePin, pinLogin };
}

// Signs an account out on every device (e.g. an admin removing an employee's access).
export async function revokeSessions(kind, companyId, employeeId) {
  const id = accountId(kind, companyId, employeeId || '');
  const account = (await getAccount(id)) || {};
  await updateAccount(id, { sessionVersion: (account.sessionVersion || 0) + 1, kind, companyId, employeeId: employeeId || null });
}

// Small dispatcher for pages/api/auth/[action].js
export function authRouter(auth, extra = {}) {
  const routes = {
    'request-otp': ['POST', (req) => auth.requestOtp(req)],
    'verify-otp': ['POST', (req, res) => auth.verifyOtp(req, res)],
    'select-account': ['POST', (req, res) => auth.selectAccount(req, res)],
    'firebase-token': ['POST', (req) => auth.firebaseToken(req)],
    logout: ['POST', (req, res) => { auth.clearSession(res); return { ok: true }; }],
    ...extra,
  };
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const route = routes[req.query.action];
    if (!route) return res.status(404).json({ error: 'Not found' });
    const [method, fn] = route;
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (method !== 'GET' && req.headers['x-crm-request'] !== '1') {
      return res.status(403).json({ error: 'Missing request header', code: 'csrf' });
    }
    try {
      const result = await fn(req, res);
      return res.status(200).json(result || { ok: true });
    } catch (err) {
      if (err instanceof CrmError) return res.status(err.status).json({ error: err.message, code: err.code });
      // Full details go to the server log (Vercel → Logs); the user gets a
      // reference to look them up.
      const ref = crypto.randomBytes(4).toString('hex');
      console.error(`[auth] error ref=${ref} action=${req.query.action}:`, err?.stack || err?.message || err);
      return res.status(500).json({ error: `Something went wrong. Please try again. (ref ${ref})`, code: 'server_error', ref });
    }
  };
}
