// "Account security" card: change password, turn on 2FA and (admins only)
// reset an employee's sign-in.
import React, { useEffect, useState } from "react";

async function call(action, { method = "POST", body } = {}) {
  const res = await fetch(`/api/auth/${action}`, {
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

const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#28BD78] focus:outline-none focus:ring-2 focus:ring-[#28BD78]/30";
const btn = "rounded-lg bg-[#28BD78] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";

function Message({ msg }) {
  if (!msg) return null;
  return <p role="status" className={`mt-2 text-sm ${msg.error ? "text-red-600" : "text-green-700"}`}>{msg.text}</p>;
}

export default function AccountSecurity({ isAdmin = false }) {
  const [status, setStatus] = useState(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwMsg, setPwMsg] = useState(null);
  const [enroll, setEnroll] = useState(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState(null);
  const [tfMsg, setTfMsg] = useState(null);
  const [empId, setEmpId] = useState("");
  const [resetMsg, setResetMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => call("security", { method: "GET" }).then(setStatus).catch(() => setStatus(null));
  useEffect(() => { load(); }, []);

  const wrap = (setMsg, fn) => async (e) => {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    try { await fn(); } catch (err) { setMsg({ error: true, text: err.message }); } finally { setBusy(false); }
  };

  return (
    <section className="mb-6 rounded-xl bg-white p-4 shadow sm:p-6" aria-labelledby="acct-sec-title">
      <h2 id="acct-sec-title" className="text-lg font-bold text-gray-800">Account security</h2>
      <p className="mb-4 text-sm text-gray-500">
        Two-factor authentication: <strong>{status ? (status.twoFactorEnabled ? "On" : "Off") : "…"}</strong>
        {status?.twoFactorEnabled ? ` · ${status.recoveryCodesLeft} recovery codes left` : ""}
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <form onSubmit={wrap(setPwMsg, async () => {
          await call("change-password", { body: { currentPassword: current, newPassword: next } });
          setCurrent(""); setNext("");
          setPwMsg({ text: "Password changed. Other devices have been signed out." });
        })}>
          <h3 className="mb-2 font-semibold text-gray-700">Change password</h3>
          <label className="mb-1 block text-xs text-gray-500" htmlFor="sec-cur">Current password</label>
          <input id="sec-cur" type="password" className={`${input} mb-2`} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          <label className="mb-1 block text-xs text-gray-500" htmlFor="sec-new">New password (10+ characters, mixed)</label>
          <input id="sec-new" type="password" className={`${input} mb-3`} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          <button type="submit" className={btn} disabled={busy}>Change password</button>
          <Message msg={pwMsg} />
        </form>

        {status && !status.twoFactorEnabled && (
          <div>
            <h3 className="mb-2 font-semibold text-gray-700">Turn on two-factor authentication</h3>
            {!enroll && !codes && (
              <button type="button" className={btn} disabled={busy} onClick={wrap(setTfMsg, async () => setEnroll(await call("enroll-start", { body: {} })))}>Set up authenticator app</button>
            )}
            {enroll && (
              <form onSubmit={wrap(setTfMsg, async () => {
                const r = await call("enroll-confirm", { body: { code } });
                setEnroll(null); setCode(""); setCodes(r.recoveryCodes); load();
              })}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enroll.qr} alt="QR code for your authenticator app" className="mb-2 h-40 w-40 rounded border" />
                <p className="mb-2 break-all text-xs text-gray-500">Key: {enroll.secret}</p>
                <input className={`${input} mb-2`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" maxLength={6} required />
                <button type="submit" className={btn} disabled={busy}>Confirm</button>
              </form>
            )}
            <Message msg={tfMsg} />
          </div>
        )}
        {codes && (
          <div className="md:col-span-2">
            <p className="mb-2 text-sm font-semibold text-gray-700">Save these recovery codes. Each works once and they will not be shown again.</p>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 font-mono text-sm sm:grid-cols-5">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          </div>
        )}

        {isAdmin && (
          <form className="md:col-span-2" onSubmit={wrap(setResetMsg, async () => {
            await call("reset-employee", { body: { employeeId: empId.trim(), password: true, twoFactor: true } });
            setResetMsg({ text: "Done. The employee will verify their email and choose a new password at next sign-in." });
            setEmpId("");
          })}>
            <h3 className="mb-2 font-semibold text-gray-700">Reset an employee&apos;s sign-in</h3>
            <p className="mb-2 text-xs text-gray-500">Clears the employee&apos;s password and 2FA and signs them out everywhere.</p>
            <div className="flex flex-wrap gap-2">
              <input className={`${input} max-w-xs`} value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="Employee ID" required />
              <button type="submit" className={btn} disabled={busy}>Reset sign-in</button>
            </div>
            <Message msg={resetMsg} />
          </form>
        )}
      </div>
    </section>
  );
}
