// Sign-in: email -> 6-digit code sent to that email -> signed in.
// All checks happen on the server (/api/auth/*).
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
const link = "text-[#28BD78] font-semibold underline disabled:opacity-60";

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
  const [challenge, setChallenge] = useState("");
  const [choice, setChoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
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

  const verify = (e) => {
    e.preventDefault();
    run(async () => finish(await call("verify-otp", { challenge, code: code.trim() })));
  };

  const pick = (index) => run(async () => finish(await call("select-account", { selection: choice.selection, index })));

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {step === "email" && (
        <form onSubmit={sendCode} className="flex flex-col gap-4 sm:gap-5">
          <div>
            <label htmlFor="cc-email" className={label}>Email address</label>
            <input id="cc-email" type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" required autoFocus />
          </div>
          <button type="submit" className={primary} disabled={busy || !email.trim()}>{busy ? "Sending code…" : "Send code"}</button>
          {footer}
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verify} className="flex flex-col gap-4">
          {info && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{info}</div>}
          <div>
            <label htmlFor="cc-code" className={label}>6-digit code sent to {email.trim()}</label>
            <input id="cc-code" className={`${input} tracking-[0.4em] text-center text-lg`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus />
          </div>
          <button type="submit" className={primary} disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Sign in"}</button>
          <div className="flex justify-between text-sm">
            <button type="button" className={link} onClick={sendCode} disabled={busy || cooldown > 0}>{cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}</button>
            <button type="button" className={link} onClick={() => { setStep("email"); setError(""); setInfo(""); }}>Change email</button>
          </div>
        </form>
      )}

      {step === "choose" && choice && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-700">This email is linked to more than one account. Choose one:</p>
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
