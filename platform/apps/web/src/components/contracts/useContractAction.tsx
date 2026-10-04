"use client";
import { useState, useTransition } from "react";
import type { ContractActionResult } from "@/lib/contracts/actions";
import { messageFor } from "@/lib/marketplace/result-messages";

/** Runs a contract server action with pending and error state. Success calls onOk (which may navigate to a provider URL). */
export function useContractAction(onOk?: (r: Extract<ContractActionResult, { ok: true }>) => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (fn: () => Promise<ContractActionResult>) =>
    start(async () => {
      setError("");
      const r = await fn();
      if (r.ok) onOk?.(r); else setError(messageFor(r));
    });
  return { pending, error, run };
}

export const btn = "rounded-md border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50";
