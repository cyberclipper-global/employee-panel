// Settings card: set, change or remove the sign-in PIN.
// Setting a PIN needs a code emailed to the account's address, so someone
// using an unlocked computer cannot add a PIN without access to the email.
import React, { useEffect, useState } from "react";

async function call(action, { method = "POST", body } = {}) {
  const res = await fetch(`/api/auth/${action}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "x-crm-request": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

const input = "w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-center text-lg tracking-[0.3em] focus:border-[#28BD78] focus:outline-none";
const primary = "rounded-lg bg-[#28BD78] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";
const secondary = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60";
const digits = (v, max) => v.replace(/\D/g, "").slice(0, max);

export default function PinSettings() {
  const [status, setStatus] = useState(null); // { hasPin, pinSetAt, email }
  const [step, setStep] = useState("idle"); // idle | enter | code
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    call("pin-status", { method: "GET" }).then(setStatus).catch((err) => setMsg({ error: true, text: err.message }));
  }, []);

  const run = async (fn) => {
    setBusy(true);
    setMsg(null);
    try { await fn(); } catch (err) { setMsg({ error: true, text: err.message }); } finally { setBusy(false); }
  };

  const reset = () => { setStep("idle"); setPin(""); setPin2(""); setCode(""); setChallenge(""); };

  const sendCode = (e) => {
    e?.preventDefault();
    if (pin.length < 6) return setMsg({ error: true, text: "The PIN must be 6 to 8 digits." });
    if (pin !== pin2) return setMsg({ error: true, text: "The two PINs do not match." });
    run(async () => {
      const data = await call("request-otp", { body: { email: status.email } });
      setChallenge(data.challenge);
      setCode("");
      setStep("code");
      setMsg({ text: `We sent a 6-digit code to ${status.email}. Enter it to confirm your new PIN.` });
    });
  };

  const confirm = (e) => {
    e.preventDefault();
    run(async () => {
      await call("set-pin", { body: { pin, challenge, code } });
      setStatus((s) => ({ ...s, hasPin: true, pinSetAt: Date.now() }));
      reset();
      setMsg({ text: "Your PIN is saved. You can now sign in with your email and this PIN, or with an email code." });
    });
  };

  const remove = () => {
    if (!window.confirm("Remove your sign-in PIN? You will sign in with an email code only.")) return;
    run(async () => {
      await call("remove-pin", { body: {} });
      setStatus((s) => ({ ...s, hasPin: false, pinSetAt: null }));
      reset();
      setMsg({ text: "Your PIN has been removed." });
    });
  };

  return (
    <section className="mb-6 rounded-xl bg-white p-4 shadow sm:p-6" aria-labelledby="pin-title">
      <h2 id="pin-title" className="text-lg font-bold text-gray-800">Sign-in PIN</h2>
      <p className="mb-3 text-sm text-gray-500">
        Sign in with your email and a PIN instead of waiting for an email code. The email code always keeps working.
        After 5 wrong PINs, PIN sign-in is locked for 15 minutes.
      </p>

      {!status && !msg && <p className="text-sm text-gray-500">Checking…</p>}

      {status && step === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.hasPin ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
            {status.hasPin ? `PIN is set${status.pinSetAt ? ` (since ${new Date(status.pinSetAt).toLocaleDateString()})` : ""}` : "No PIN set"}
          </span>
          <button type="button" className={primary} disabled={busy} onClick={() => { setMsg(null); setStep("enter"); }}>
            {status.hasPin ? "Change PIN" : "Set PIN"}
          </button>
          {status.hasPin && <button type="button" className={secondary} disabled={busy} onClick={remove}>Remove PIN</button>}
        </div>
      )}

      {step === "enter" && (
        <form onSubmit={sendCode} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-gray-700" htmlFor="pin-new">New PIN (6 to 8 digits)</label>
          <input id="pin-new" type="password" inputMode="numeric" autoComplete="new-password" className={input} value={pin} onChange={(e) => setPin(digits(e.target.value, 8))} required autoFocus />
          <label className="text-sm font-semibold text-gray-700" htmlFor="pin-again">Type the PIN again</label>
          <input id="pin-again" type="password" inputMode="numeric" autoComplete="new-password" className={input} value={pin2} onChange={(e) => setPin2(digits(e.target.value, 8))} required />
          <p className="text-xs text-gray-500">Avoid easy PINs like 111111 or 123456.</p>
          <div className="flex gap-2">
            <button type="submit" className={primary} disabled={busy || pin.length < 6 || pin2.length < 6}>{busy ? "Sending code…" : "Continue"}</button>
            <button type="button" className={secondary} disabled={busy} onClick={() => { reset(); setMsg(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={confirm} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-gray-700" htmlFor="pin-code">6-digit code sent to {status?.email}</label>
          <input id="pin-code" inputMode="numeric" autoComplete="one-time-code" className={input} value={code} onChange={(e) => setCode(digits(e.target.value, 6))} required autoFocus />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primary} disabled={busy || code.length !== 6}>{busy ? "Saving…" : "Save PIN"}</button>
            <button type="button" className={secondary} disabled={busy} onClick={sendCode}>Resend code</button>
            <button type="button" className={secondary} disabled={busy} onClick={() => { reset(); setMsg(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {msg && <p role="status" className={`mt-3 text-sm ${msg.error ? "text-red-600" : "text-green-700"}`}>{msg.text}</p>}
    </section>
  );
}
