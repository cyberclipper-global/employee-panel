// Login engine shared by the admin and employee panels.
//
// Steps: password -> (first time / forgot: email code + new password)
//        -> 2FA (authenticator app) or 2FA enrolment -> session.
// Accounts live in the admin Firestore project (`authAccounts`), which only the
// server can read. Sessions are HttpOnly, signed cookies; every request
// re-checks the account's session version, so a password reset logs out all
// devices.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { getCrmDb, FieldValue } from '../crm/firestore';
import { CrmError } from '../crm/errors';
import { rateLimit, clientIp, readCookie } from '../crm/http';
import { hashPassword, verifyPassword, burnPasswordTime, passwordProblem } from './password';
import { generateSecret, verifyTotp, otpauthUrl } from './totp';
import { sealSecret, openSecret, codeHash, safeEqualHex, randomDigits, makeRecoveryCodes, normalizeRecoveryCode } from './secrets';
import { sendVerificationCode } from './mailer';

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_TTL = 10 * 60;
const ID_RE = /^[^/\s]{1,128}$/;
// How long a session check may be served from memory (password resets and
// admin resets take effect within this time).
const SESSION_CACHE_MS = Number(process.env.AUTH_SESSION_CACHE_MS ?? 30000);

export const authError = (status, message, code) => new CrmError(status, message, code);
const invalid = () => authError(401, 'Invalid credentials', 'invalid_credentials');

export function accountId(kind, companyId, employeeId = '') {
  return crypto.createHash('sha256').update(`${kind}:${companyId}:${employeeId}`).digest('hex').slice(0, 40);
}

const accountsCol = () => getCrmDb().collection('authAccounts');

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
  // config: { kind, appName, cookieName, sessionTtlSeconds, secret(), resolvePrincipal(companyId, loginId),
  //   require2fa(principal, account), sessionClaims(principal), firebase: { auth(), uid(p), claims(p) } }
  const challengeAud = `cc-auth-challenge-${config.kind}`;
  const sessionAud = `cc-session-${config.kind}`;
  const versionCache = new Map();

  function cleanIds(companyId, loginId) {
    const cid = typeof companyId === 'string' ? companyId.trim() : '';
    const lid = typeof loginId === 'string' ? loginId.trim() : '';
    if (!ID_RE.test(cid) || !ID_RE.test(lid)) throw invalid();
    return { cid, lid };
  }

  function signChallenge(principal, step, extra = {}) {
    return jwt.sign({ cid: principal.companyId, lid: principal.loginId, st: step, ...extra }, config.secret(), {
      algorithm: 'HS256', audience: challengeAud, expiresIn: CHALLENGE_TTL,
    });
  }

  async function readChallenge(token, steps) {
    let p;
    try {
      p = jwt.verify(String(token || ''), config.secret(), { algorithms: ['HS256'], audience: challengeAud });
    } catch {
      throw authError(401, 'This step has expired. Please sign in again.', 'challenge_expired');
    }
    if (!steps.includes(p.st)) throw authError(400, 'Unexpected step. Please sign in again.', 'bad_step');
    const principal = await config.resolvePrincipal(p.cid, p.lid);
    if (!principal) throw authError(401, 'This step has expired. Please sign in again.', 'challenge_expired');
    const id = accountId(config.kind, principal.companyId, principal.employeeId);
    const account = (await getAccount(id)) || {};
    // A challenge issued before a password change is no longer valid.
    if (p.pw !== undefined && p.pw !== (account.passwordSetAt || 0)) {
      throw authError(401, 'This step has expired. Please sign in again.', 'challenge_expired');
    }
    return { principal, id, account, payload: p };
  }

  async function assertNotLocked(id, account) {
    if (account && account.lockedUntil && account.lockedUntil > Date.now()) {
      const minutes = Math.ceil((account.lockedUntil - Date.now()) / 60000);
      throw authError(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, 'locked');
    }
  }

  async function recordFailure(id, account) {
    const failed = ((account && account.lockedUntil && account.lockedUntil > Date.now()) ? 0 : (account?.failedCount || 0)) + 1;
    const update = { failedCount: failed, kind: config.kind };
    if (failed >= MAX_FAILURES) {
      update.lockedUntil = Date.now() + LOCK_MS;
      update.failedCount = 0;
    }
    await updateAccount(id, update);
  }

  async function issueSession(res, principal, account) {
    const id = accountId(config.kind, principal.companyId, principal.employeeId);
    const sv = account?.sessionVersion || 0;
    const token = jwt.sign({ ...config.sessionClaims(principal), sv }, config.secret(), {
      algorithm: 'HS256', audience: sessionAud, expiresIn: config.sessionTtlSeconds,
    });
    res.setHeader('Set-Cookie', `${config.cookieName}=${token}; ${cookieAttrs(config.sessionTtlSeconds)}`);
    await updateAccount(id, { lastLoginAt: Date.now(), failedCount: 0, lockedUntil: 0, kind: config.kind, companyId: principal.companyId, employeeId: principal.employeeId || null });
    return { next: 'done' };
  }

  function clearSession(res) {
    res.setHeader('Set-Cookie', `${config.cookieName}=; ${cookieAttrs(0)}`);
  }

  async function afterPassword(res, principal, account) {
    const pw = account.passwordSetAt || 0;
    if (account.totpEnabled) return { next: 'otp', challenge: signChallenge(principal, 'otp', { pw }) };
    if (config.require2fa(principal, account)) return { next: 'enroll', challenge: signChallenge(principal, 'enroll', { pw }) };
    return issueSession(res, principal, account);
  }

  async function verifyRecaptcha(req, token) {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) return;
    if (!token) throw authError(400, 'Please complete the captcha', 'captcha');
    const body = new URLSearchParams({ secret, response: String(token), remoteip: clientIp(req) });
    try {
      const r = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body });
      const j = await r.json();
      if (!j.success) throw new Error('captcha');
    } catch {
      throw authError(400, 'Captcha check failed. Please try again.', 'captcha');
    }
  }

  // --- actions -------------------------------------------------------------

  async function login(req, res) {
    const { companyId, loginId, password, captcha } = req.body || {};
    rateLimit(`auth-login:${config.kind}:${clientIp(req)}`, 30, 10 * 60 * 1000);
    const { cid, lid } = cleanIds(companyId, loginId);
    await verifyRecaptcha(req, captcha);
    const principal = await config.resolvePrincipal(cid, lid);
    if (!principal) {
      await burnPasswordTime(password);
      throw invalid();
    }
    const id = accountId(config.kind, principal.companyId, principal.employeeId);
    const account = (await getAccount(id)) || {};
    await assertNotLocked(id, account);
    if (!account.passwordHash) {
      // First sign-in since passwords were introduced: prove access to the
      // registered email, then choose a password.
      return { next: 'setup_required' };
    }
    if (typeof password !== 'string' || !(await verifyPassword(password, account.passwordHash))) {
      await recordFailure(id, account);
      throw invalid();
    }
    await updateAccount(id, { failedCount: 0 });
    return afterPassword(res, principal, account);
  }

  async function requestCode(req) {
    const { companyId, loginId, purpose, captcha } = req.body || {};
    const kind = purpose === 'reset' ? 'reset' : 'setup';
    rateLimit(`auth-code:${config.kind}:${clientIp(req)}`, 10, 10 * 60 * 1000);
    const { cid, lid } = cleanIds(companyId, loginId);
    await verifyRecaptcha(req, captcha);
    const generic = { ok: true, message: 'If these details are correct, a 6-digit code has been sent to the registered email address.' };
    const principal = await config.resolvePrincipal(cid, lid);
    if (!principal) return { ...generic, challenge: jwt.sign({ cid, lid, st: 'code', p: kind }, config.secret(), { algorithm: 'HS256', audience: challengeAud, expiresIn: CHALLENGE_TTL }) };
    const id = accountId(config.kind, principal.companyId, principal.employeeId);
    const account = (await getAccount(id)) || {};
    await assertNotLocked(id, account);
    rateLimit(`auth-code-account:${id}`, 5, 60 * 60 * 1000);
    if (!principal.email) {
      // Same response as success so the endpoint cannot be used to probe IDs.
      console.warn('[auth] verification requested for an account without email');
      return { ...generic, challenge: signChallenge(principal, 'code', { p: kind }) };
    }
    const code = randomDigits(6);
    await updateAccount(id, {
      kind: config.kind,
      emailCode: { hash: codeHash(`${id}:${code}`), expiresAt: Date.now() + CODE_TTL_MS, attempts: 0, purpose: kind },
    });
    try {
      await sendVerificationCode({ to: principal.email, code, appName: config.appName, purpose: kind });
    } catch (err) {
      console.error('[auth] could not send verification email:', err.code || err.message);
      throw authError(503, 'Could not send the verification email. Please try again later or contact your administrator.', 'email_failed');
    }
    return { ...generic, challenge: signChallenge(principal, 'code', { p: kind }) };
  }

  async function setPassword(req, res) {
    const { challenge, code, password } = req.body || {};
    rateLimit(`auth-setpw:${config.kind}:${clientIp(req)}`, 20, 10 * 60 * 1000);
    const { principal, id, account } = await readChallenge(challenge, ['code']);
    await assertNotLocked(id, account);
    const ec = account.emailCode;
    if (!ec || ec.expiresAt < Date.now() || ec.attempts >= 5) {
      throw authError(400, 'The code has expired. Request a new one.', 'code_expired');
    }
    if (!safeEqualHex(codeHash(`${id}:${String(code || '').trim()}`), ec.hash)) {
      await updateAccount(id, { emailCode: { ...ec, attempts: (ec.attempts || 0) + 1 } });
      throw authError(400, 'The code is not correct', 'bad_code');
    }
    const problem = passwordProblem(password, { identifiers: [principal.companyId, principal.loginId] });
    if (problem) throw authError(400, problem, 'weak_password');
    const passwordSetAt = Date.now();
    const next = {
      passwordHash: await hashPassword(password),
      passwordSetAt,
      emailCode: FieldValue.delete(),
      failedCount: 0,
      lockedUntil: 0,
      sessionVersion: (account.sessionVersion || 0) + 1,
      kind: config.kind,
      companyId: principal.companyId,
      employeeId: principal.employeeId || null,
      createdAt: account.createdAt || Date.now(),
    };
    await updateAccount(id, next);
    versionCache.delete(id);
    return afterPassword(res, principal, { ...account, ...next });
  }

  async function verify2fa(req, res) {
    const { challenge, code, recoveryCode } = req.body || {};
    rateLimit(`auth-2fa:${config.kind}:${clientIp(req)}`, 30, 10 * 60 * 1000);
    const { principal, id, account } = await readChallenge(challenge, ['otp']);
    await assertNotLocked(id, account);
    if (!account.totpEnabled) throw authError(400, 'Two-factor authentication is not set up', 'bad_step');
    if (recoveryCode) {
      const h = codeHash(`${id}:rc:${normalizeRecoveryCode(recoveryCode)}`);
      const codes = account.recoveryCodes || [];
      if (!codes.includes(h)) {
        await recordFailure(id, account);
        throw authError(401, 'Recovery code is not valid', 'bad_code');
      }
      await updateAccount(id, { recoveryCodes: codes.filter((c) => c !== h) });
      return issueSession(res, principal, account);
    }
    const step = verifyTotp(openSecret(account.totpSecret), code, { lastUsedStep: account.totpLastStep ?? -1 });
    if (step === null) {
      await recordFailure(id, account);
      throw authError(401, 'The code is not correct', 'bad_code');
    }
    await updateAccount(id, { totpLastStep: step });
    return issueSession(res, principal, account);
  }

  async function enrollTarget(req) {
    const { challenge } = req.body || {};
    if (challenge) return readChallenge(challenge, ['enroll']);
    const session = await requireSession(req);
    const id = accountId(config.kind, session.principal.companyId, session.principal.employeeId);
    return { principal: session.principal, id, account: (await getAccount(id)) || {}, fromSession: true };
  }

  async function enrollStart(req) {
    const { principal, id, account } = await enrollTarget(req);
    if (account.totpEnabled) throw authError(400, 'Two-factor authentication is already on', 'already_enabled');
    const secret = generateSecret();
    await updateAccount(id, { pendingTotpSecret: sealSecret(secret), kind: config.kind });
    const url = otpauthUrl({ issuer: config.appName, account: principal.displayLogin || principal.loginId, secret });
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    return { otpauthUrl: url, secret, qr };
  }

  async function enrollConfirm(req, res) {
    const target = await enrollTarget(req);
    const { principal, id, account } = target;
    if (!account.pendingTotpSecret) throw authError(400, 'Start the setup again', 'bad_step');
    const secret = openSecret(account.pendingTotpSecret);
    const step = verifyTotp(secret, req.body?.code);
    if (step === null) throw authError(400, 'The code is not correct. Check the time on your phone and try again.', 'bad_code');
    const codes = makeRecoveryCodes();
    const update = {
      totpSecret: sealSecret(secret),
      totpEnabled: true,
      totpLastStep: step,
      pendingTotpSecret: FieldValue.delete(),
      recoveryCodes: codes.map((c) => codeHash(`${id}:rc:${normalizeRecoveryCode(c)}`)),
    };
    await updateAccount(id, update);
    if (!target.fromSession) await issueSession(res, principal, { ...account, ...update });
    return { next: 'done', recoveryCodes: codes };
  }

  // Verifies the session cookie; returns { principal, payload } or throws 401.
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
    const id = accountId(config.kind, ids.companyId, ids.employeeId);
    const hit = versionCache.get(id);
    let state = hit && hit.expires > Date.now() ? hit.value : null;
    if (!state) {
      const [account, principal] = await Promise.all([getAccount(id), config.resolvePrincipal(ids.companyId, ids.loginId)]);
      state = { sv: account?.sessionVersion || 0, principal };
      versionCache.set(id, { value: state, expires: Date.now() + SESSION_CACHE_MS });
      if (versionCache.size > 5000) versionCache.clear();
    }
    if (!state.principal || state.sv !== (payload.sv || 0)) {
      throw authError(401, 'Your session is no longer valid. Please sign in again.', 'unauthorized');
    }
    return { principal: state.principal, payload };
  }

  async function changePassword(req, res) {
    const session = await requireSession(req);
    const { currentPassword, newPassword } = req.body || {};
    const { principal } = session;
    const id = accountId(config.kind, principal.companyId, principal.employeeId);
    const account = (await getAccount(id)) || {};
    await assertNotLocked(id, account);
    if (!account.passwordHash || !(await verifyPassword(currentPassword || '', account.passwordHash))) {
      await recordFailure(id, account);
      throw authError(400, 'Current password is not correct', 'bad_password');
    }
    const problem = passwordProblem(newPassword, { identifiers: [principal.companyId, principal.loginId] });
    if (problem) throw authError(400, problem, 'weak_password');
    const update = { passwordHash: await hashPassword(newPassword), passwordSetAt: Date.now(), sessionVersion: (account.sessionVersion || 0) + 1 };
    await updateAccount(id, update);
    versionCache.delete(id);
    await issueSession(res, principal, { ...account, ...update });
    return { ok: true };
  }

  async function securityStatus(req) {
    const { principal } = await requireSession(req);
    const account = (await getAccount(accountId(config.kind, principal.companyId, principal.employeeId))) || {};
    return {
      twoFactorEnabled: Boolean(account.totpEnabled),
      twoFactorRequired: Boolean(config.require2fa(principal, account)),
      recoveryCodesLeft: (account.recoveryCodes || []).length,
      passwordSetAt: account.passwordSetAt || null,
    };
  }

  async function firebaseToken(req) {
    const { principal } = await requireSession(req);
    const token = await config.firebase.auth().createCustomToken(config.firebase.uid(principal), config.firebase.claims(principal));
    return { token, uid: config.firebase.uid(principal) };
  }

  async function resetAccount(companyId, employeeId, opts) {
    await resetCredentials(config.kind, companyId, employeeId, opts);
    versionCache.delete(accountId(config.kind, companyId, employeeId || ''));
  }

  return {
    login, requestCode, setPassword, verify2fa, enrollStart, enrollConfirm, changePassword, securityStatus,
    firebaseToken, requireSession, clearSession, resetAccount,
  };
}

// Clears password and/or 2FA of any account kind (e.g. an admin resetting an
// employee). The user then sets them again through the email-code flow.
export async function resetCredentials(kind, companyId, employeeId, { password = true, twoFactor = true } = {}) {
  const id = accountId(kind, companyId, employeeId || '');
  const account = (await getAccount(id)) || {};
  const update = { sessionVersion: (account.sessionVersion || 0) + 1, failedCount: 0, lockedUntil: 0, kind, companyId, employeeId: employeeId || null };
  if (password) Object.assign(update, { passwordHash: FieldValue.delete(), passwordSetAt: Date.now() });
  if (twoFactor) Object.assign(update, { totpEnabled: false, totpSecret: FieldValue.delete(), recoveryCodes: [], pendingTotpSecret: FieldValue.delete() });
  await updateAccount(id, update);
}

// Small dispatcher for pages/api/auth/[action].js
export function authRouter(auth, extra = {}) {
  const routes = {
    login: ['POST', (req, res) => auth.login(req, res)],
    'request-code': ['POST', (req) => auth.requestCode(req)],
    'set-password': ['POST', (req, res) => auth.setPassword(req, res)],
    'verify-2fa': ['POST', (req, res) => auth.verify2fa(req, res)],
    'enroll-start': ['POST', (req) => auth.enrollStart(req)],
    'enroll-confirm': ['POST', (req, res) => auth.enrollConfirm(req, res)],
    'change-password': ['POST', (req, res) => auth.changePassword(req, res)],
    security: ['GET', (req) => auth.securityStatus(req)],
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
      console.error('[auth] error:', err?.message);
      return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
}
