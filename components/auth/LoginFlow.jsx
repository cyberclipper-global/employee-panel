// Multi-step sign-in: credentials -> (email code + new password) -> 2FA or
// 2FA setup -> recovery codes. All checks happen on the server.
import React, { useEffect, useState } from "react";

async function call(action, body) {
  const res = await fetch(`/api/auth/${action}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "x-crm-request": "1" },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

const input = "w-full py-3 px-4 text-gray-700 rounded-lg border border-[#e0dfea] text-[15px] bg-[#f8f9fa] outline-none focus:border-[#28BD78] focus:ring-2 focus:ring-[#28BD78]";
const label = "font-semibold text-[14px] sm:text-[15px] text-[#22223b] mb-1 block";
const primary = "w-full py-[13px] rounded-lg text-[16px] font-bold tracking-wide bg-[#28BD78] text-white disabled:bg-[#9fdcbf] disabled:cursor-not-allowed";
const link = "text-[#28BD78] font-semibold underline";

function Field({ id, title, children, hint }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{title}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, required = true }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? "text" : "password"} className={`${input} pr-16`} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required={required} />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#28BD78]">{show ? "Hide" : "Show"}</button>
    </div>
  );
}

/**
 * props:
 *  panel: 'admin' | 'employee'
 *  loginIdLabel: e.g. "Admin ID (AID)" / "Employee ID"
 *  initialCompanyId
 *  captcha: optional render function (onChange) => element
 *  onSignedIn: async () => void
 */
export default function LoginFlow({ loginIdLabel, initialCompanyId = "", captcha, onSignedIn, footer }) {
  const [step, setStep] = useState("credentials");
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState(null);
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [enroll, setEnroll] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [purpose, setPurpose] = useState("setup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => { if (initialCompanyId) setCompanyId(initialCompanyId); }, [initialCompanyId]);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const handleNext = async (data) => {
    setCode("");
    if (data.next === "done") {
      if (data.recoveryCodes) { setRecoveryCodes(data.recoveryCodes); setStep("recovery"); return; }
      setStep("finishing");
      await onSignedIn();
      return;
    }
    if (data.next === "otp") { setChallenge(data.challenge); setStep("otp"); return; }
    if (data.next === "enroll") {
      setChallenge(data.challenge);
      const e = await call("enroll-start", { challenge: data.challenge });
      setEnroll(e);
      setStep("enroll");
      return;
    }
    if (data.next === "setup_required") {
      setPurpose("setup");
      setInfo("For security, verify your email and choose a password. This is needed once.");
      setStep("request_code");
    }
  };

  const submitCredentials = (e) => {
    e.preventDefault();
    run(async () => {
      const data = await call("login", { companyId: companyId.trim(), loginId: loginId.trim(), password, captcha: captchaToken });
      await handleNext(data);
    });
  };

  const requestCode = (e) => {
    e?.preventDefault();
    run(async () => {
      const data = await call("request-code", { companyId: companyId.trim(), loginId: loginId.trim(), purpose, captcha: captchaToken });
      setChallenge(data.challenge);
      setInfo(data.message);
      setStep("set_password");
    });
  };

  const submitNewPassword = (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    run(async () => {
      const data = await call("set-password", { challenge, code: code.trim(), password: newPassword });
      setInfo("");
      await handleNext(data);
    });
  };

  const submitOtp = (e) => {
    e.preventDefault();
    run(async () => {
      const data = await call("verify-2fa", useRecovery ? { challenge, recoveryCode: code } : { challenge, code: code.trim() });
      await handleNext(data);
    });
  };

  const submitEnroll = (e) => {
    e.preventDefault();
    run(async () => {
      const data = await call("enroll-confirm", { challenge, code: code.trim() });
      await handleNext(data);
    });
  };

  const restart = () => { setStep("credentials"); setPassword(""); setCode(""); setError(""); setInfo(""); setEnroll(null); };

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {info && step !== "credentials" && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{info}</div>}

      {step === "credentials" && (
        <form onSubmit={submitCredentials} className="flex flex-col gap-4 sm:gap-5">
          <Field id="cc-company" title="Company ID">
            <input id="cc-company" className={input} value={companyId} onChange={(e) => setCompanyId(e.target.value)} autoComplete="organization" placeholder="CID-..." required />
          </Field>
          <Field id="cc-login" title={loginIdLabel}>
            <input id="cc-login" className={input} value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" required />
          </Field>
          <Field id="cc-password" title="Password" hint="Signing in for the first time? Leave it empty and continue.">
            <PasswordInput id="cc-password" value={password} onChange={setPassword} autoComplete="current-password" required={false} />
          </Field>
          {captcha && <div className="flex justify-center">{captcha(setCaptchaToken)}</div>}
          <button type="submit" className={primary} disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
          <div className="text-center text-sm">
            <button type="button" className={link} onClick={() => { if (!companyId.trim() || !loginId.trim()) { setError(`Enter your Company ID and ${loginIdLabel} first`); return; } setPurpose("reset"); setInfo(""); setStep("request_code"); }}>
              Forgot password?
            </button>
          </div>
          {footer}
        </form>
      )}

      {step === "request_code" && (
        <form onSubmit={requestCode} className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">We will email a 6-digit code to the address registered for <strong>{loginId}</strong>.</p>
          <button type="submit" className={primary} disabled={busy}>{busy ? "Sending…" : "Send code"}</button>
          <button type="button" className={link} onClick={restart}>Back</button>
        </form>
      )}

      {step === "set_password" && (
        <form onSubmit={submitNewPassword} className="flex flex-col gap-4">
          <Field id="cc-code" title="6-digit code from your email">
            <input id="cc-code" className={input} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
          </Field>
          <Field id="cc-newpw" title="New password" hint="At least 10 characters, with three of: lowercase, uppercase, numbers, symbols.">
            <PasswordInput id="cc-newpw" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          </Field>
          <Field id="cc-confirm" title="Confirm new password">
            <PasswordInput id="cc-confirm" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
          </Field>
          <button type="submit" className={primary} disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
          <div className="flex justify-between text-sm">
            <button type="button" className={link} onClick={requestCode} disabled={busy}>Resend code</button>
            <button type="button" className={link} onClick={restart}>Back</button>
          </div>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={submitOtp} className="flex flex-col gap-4">
          {useRecovery ? (
            <Field id="cc-otp" title="Recovery code"><input id="cc-otp" className={input} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required /></Field>
          ) : (
            <Field id="cc-otp" title="6-digit code from your authenticator app">
              <input id="cc-otp" className={`${input} tracking-[0.4em] text-center text-lg`} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required />
            </Field>
          )}
          <button type="submit" className={primary} disabled={busy}>{busy ? "Verifying…" : "Verify"}</button>
          <div className="flex justify-between text-sm">
            <button type="button" className={link} onClick={() => { setUseRecovery((v) => !v); setCode(""); }}>{useRecovery ? "Use authenticator code" : "Use a recovery code"}</button>
            <button type="button" className={link} onClick={restart}>Back</button>
          </div>
        </form>
      )}

      {step === "enroll" && enroll && (
        <form onSubmit={submitEnroll} className="flex flex-col gap-4">
          <p className="text-sm text-gray-700">Set up two-factor authentication. Scan this QR code with Google Authenticator, Microsoft Authenticator or a similar app, then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="QR code for your authenticator app" className="mx-auto h-48 w-48 rounded border" />
          <details className="text-xs text-gray-600"><summary className="cursor-pointer">Can&apos;t scan? Enter this key manually</summary><code className="mt-1 block break-all rounded bg-gray-100 p-2">{enroll.secret}</code></details>
          <Field id="cc-enroll" title="6-digit code">
            <input id="cc-enroll" className={`${input} tracking-[0.4em] text-center text-lg`} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
          </Field>
          <button type="submit" className={primary} disabled={busy}>{busy ? "Verifying…" : "Turn on 2FA"}</button>
        </form>
      )}

      {step === "recovery" && recoveryCodes && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-700"><strong>Save these recovery codes.</strong> Each one can be used once to sign in if you lose your phone. They will not be shown again.</p>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 font-mono text-sm">{recoveryCodes.map((c) => <span key={c}>{c}</span>)}</div>
          <button type="button" className="text-sm font-semibold text-[#28BD78] underline" onClick={() => navigator.clipboard?.writeText(recoveryCodes.join("\n"))}>Copy codes</button>
          <button type="button" className={primary} onClick={() => run(async () => { setStep("finishing"); await onSignedIn(); })}>I have saved them — continue</button>
        </div>
      )}

      {step === "finishing" && <div className="py-6 text-center text-sm text-gray-600">Signing you in…</div>}
    </div>
  );
}
