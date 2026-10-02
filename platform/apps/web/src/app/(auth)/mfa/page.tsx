"use client";
import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export default function Mfa() {
  const [factorId, setFactorId] = useState<string>();
  const [qr, setQr] = useState<string>();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string>();

  useEffect(() => {
    (async () => {
      const supabase = createBrowserSupabase();
      const { data: list } = await supabase.auth.mfa.listFactors();
      const verified = list?.totp?.[0];
      if (verified) return setFactorId(verified.id); // challenge an existing factor
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) return setMsg("Could not start two-factor setup.");
      setFactorId(data.id);
      setQr(data.totp.qr_code);
    })();
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    const supabase = createBrowserSupabase();
    const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId });
    if (ce || !ch) return setMsg("Could not start verification.");
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
    if (error) return setMsg("That code did not work. Try again.");
    window.location.assign("/dashboard");
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Two-factor authentication</h1>
      {qr && (
        <>
          <p className="mt-4 text-sm">Scan with your authenticator app, then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Authenticator QR code" className="mt-4 h-40 w-40" />
        </>
      )}
      <form onSubmit={verify} className="mt-6 space-y-4">
        <label className="block text-sm">6-digit code
          <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2" />
        </label>
        <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-white dark:bg-white dark:text-neutral-900">Verify</button>
      </form>
      {msg && <p role="alert" className="mt-4 text-sm text-red-600">{msg}</p>}
    </main>
  );
}
