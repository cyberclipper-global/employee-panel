// Sign-in: email -> 6-digit code sent to that email (or the account's PIN) -> signed in.
// All checks happen on the server (/api/auth/*).
import React, { useEffect, useState } from "react";
import { Mail, Lock, KeyRound, ChevronRight } from "lucide-react";

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
  if (!res.ok) {
    const err = new Error(data.error || "Something went wrong. Please try again.");
    err.code = data.code;
    throw err;
  }
  return data;
}

const input = "w-full py-3 px-4 text-gray-700 rounded-lg border border-[#e0dfea] text-[15px] bg-[#f8f9fa] outline-none focus:border-[#28BD78] focus:ring-2 focus:ring-[#28BD78]";
const primary = "w-full py-[13px] rounded-lg text-[16px] font-bold tracking-wide bg-[#28BD78] text-white disabled:bg-[#9fdcbf] disabled:cursor-not-allowed";
const link = "text-[#28BD78] font-semibold underline disabled:opacity-60";
const iconInput = "w-full py-3 pl-11 pr-4 text-gray-700 rounded-xl border border-[#e0dfea] text-[15px] bg-[#f8f9fa] outline-none focus:border-[#28BD78] focus:ring-2 focus:ring-[#28BD78]";
const iconWrap = "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500";
const switchBtn = "w-full flex items-center justify-center gap-2 py-[11px] rounded-xl text-[15px] font-semibold border border-[#28BD78] text-[#1f8f5c] bg-white hover:bg-green-50 disabled:opacity-60";
const primaryArrow = `${primary} rounded-xl flex items-center justify-center gap-1`;

/**
 * props:
 *  initialEmail: optional pre-filled email
 *  onSignedIn: async () => void
 *  footer: optional element under the email form
 */
export default function LoginFlow({ initialEmail = "", onSignedIn, footer }) {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [challenge, setChallenge] = useState("");
  const [choice, setChoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [info, setInfo] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => { if (initialEmail) setEmail(initialEmail); }, [initialEmail]);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    setErrorCode("");
    try { await fn(); } catch (err) { setError(err.message); setErrorCode(err.code || ""); } finally { setBusy(false); }
  };

  const finish = async (data) => {
    if (data.next === "choose") {
      setChoice({ selection: data.selection, accounts: data.accounts });
      setStep("choose");
      return;
    }
    setStep("finishing");
    await onSignedIn();
  };

  const sendCode = (e) => {
    e?.preventDefault();
    run(async () => {
      const data = await call("request-otp", { email: email.trim() });
      setChallenge(data.challenge);
      setInfo(`${data.message} It is valid for 10 minutes.`);
      setCode("");
      setCooldown(30);
      setStep("code");
    });
  };

  const switchTo = (next) => {
    setError(""); setErrorCode(""); setInfo(""); setPin("");
    setStep(next);
  };

  const pinSignIn = (e) => {
    e.preventDefault();
    run(async () => finish(await call("pin-login", { email: email.trim(), pin })));
  };

  const verify = (e) => {
    e.preventDefault();
    run(async () => finish(await call("verify-otp", { challenge, code: code.trim() })));
  };

  const pick = (index) => run(async () => finish(await call("select-account", { selection: choice.selection, index })));

  const titles = {
    email: ["Login with Email OTP", "Secure sign-in with your email and one-time passcode."],
    code: ["Login with Email OTP", `Enter the 6-digit code we sent to ${email.trim()}.`],
    pin: ["Login with PIN", "Sign in with your email and the PIN you set in Passwords & Security."],
    choose: ["Choose an account", "This email is linked to more than one account."],
    finishing: ["Signing you in", ""],
  };
  const [title, subtitle] = titles[step] || titles.email;
  const clearAccessError = () => { if (errorCode === "no_access") { setError(""); setErrorCode(""); } };

  const emailField = (
    <div className="relative">
      <span className={iconWrap}><Mail size={18} aria-hidden="true" /></span>
      <input id="cc-email" type="email" aria-label="Email address" className={iconInput} value={email} onChange={(e) => { setEmail(e.target.value); clearAccessError(); }} autoComplete="email" placeholder="Email Address" required autoFocus={!email} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="text-center">
        <h2 className="text-[24px] sm:text-[28px] font-extrabold text-[#28BD78]">{title}</h2>
        {subtitle && <p className="mt-1 text-[#6b7280] text-[14px] sm:text-[15px]">{subtitle}</p>}
      </div>
      {error && errorCode === "no_access" && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-bold text-red-800">Access denied</p>
          <p className="mt-1">{error}</p>
        </div>
      )}
      {error && errorCode !== "no_access" && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {step === "email" && (
        <form onSubmit={sendCode} className="flex flex-col gap-4">
          {emailField}
          <button type="submit" className={primaryArrow} disabled={busy || !email.trim()}>
            {busy ? "Sending OTP…" : <>Send OTP <ChevronRight size={18} aria-hidden="true" /></>}
          </button>
          <button type="button" className={switchBtn} onClick={() => switchTo("pin")} disabled={busy}>
            <KeyRound size={17} aria-hidden="true" /> Login via PIN
          </button>
          {footer}
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verify} className="flex flex-col gap-4">
          {info && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{info}</div>}
          <input id="cc-code" aria-label="6-digit code" placeholder="6-digit OTP" className={`${input} rounded-xl tracking-[0.4em] text-center text-lg`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus />
          <button type="submit" className={primaryArrow} disabled={busy || code.length !== 6}>
            {busy ? "Verifying…" : <>Verify OTP <ChevronRight size={18} aria-hidden="true" /></>}
          </button>
          <div className="flex justify-between text-sm">
            <button type="button" className={link} onClick={sendCode} disabled={busy || cooldown > 0}>{cooldown > 0 ? `Resend OTP in ${cooldown}s` : "Resend OTP"}</button>
            <button type="button" className={link} onClick={() => switchTo("email")}>Change email</button>
          </div>
        </form>
      )}

      {step === "pin" && (
        <form onSubmit={pinSignIn} className="flex flex-col gap-4">
          {emailField}
          <div className="relative">
            <span className={iconWrap}><Lock size={18} aria-hidden="true" /></span>
            <input id="cc-pin" type="password" aria-label="PIN" placeholder="6–8 digit PIN" className={iconInput} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="current-password" minLength={6} maxLength={8} required autoFocus={!!email} />
          </div>
          <button type="submit" className={primaryArrow} disabled={busy || !email.trim() || pin.length < 6}>
            {busy ? "Checking…" : <>Login with PIN <ChevronRight size={18} aria-hidden="true" /></>}
          </button>
          <button type="button" className={switchBtn} onClick={() => switchTo("email")} disabled={busy}>
            <KeyRound size={17} aria-hidden="true" /> Login via OTP
          </button>
          {footer}
        </form>
      )}

      {step === "choose" && choice && (
        <div className="flex flex-col gap-3">
          {choice.accounts.map((a) => (
            <button key={a.index} type="button" className="w-full rounded-lg border border-[#e0dfea] bg-white px-4 py-3 text-left text-sm font-semibold text-gray-800 hover:border-[#28BD78]" disabled={busy} onClick={() => pick(a.index)}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {step === "finishing" && <div className="py-6 text-center text-sm text-gray-600">Signing you in…</div>}
    </div>
  );
}
