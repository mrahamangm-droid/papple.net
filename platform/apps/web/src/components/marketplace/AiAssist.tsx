"use client";
import { useRef, useState, useTransition } from "react";
import { aiMessageFor } from "@/lib/ai/messages";
import type { AiResult } from "@/lib/ai/service";

/** Fills a text box with a suggestion. It never submits anything: the person edits and sends the form themselves. */
export function AiAssist({ target, label, build, action }: {
  target: string;
  label: string;
  /** Returns the action input from the form, or null when there is not enough text to work with. */
  build: (f: FormData) => unknown | null;
  action: (input: unknown) => Promise<AiResult>;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<string | null>(null);

  const field = () => ref.current?.closest("form")?.elements.namedItem(target) as HTMLTextAreaElement | null;
  const write = (el: HTMLTextAreaElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const click = () => {
    const form = ref.current?.closest("form");
    const el = field();
    if (!form || !el) return;
    setError("");
    const input = build(new FormData(form));
    if (input === null) { setError("Write a few words first so the assistant has something to work with."); return; }
    start(async () => {
      const r = await action(input);
      if (!r.ok) { setError(aiMessageFor(r)); return; }
      setUndo(el.value);
      write(el, r.text);
    });
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
      <button ref={ref} type="button" onClick={click} disabled={pending} className="rounded-md border border-neutral-400 px-3 py-1 disabled:opacity-60">
        {pending ? "Thinking…" : label}
      </button>
      {undo !== null && (
        <>
          <span className="text-neutral-600">AI suggestion. Review and edit it before you send.</span>
          <button type="button" className="underline" onClick={() => { const el = field(); if (el) write(el, undo); setUndo(null); }}>Undo</button>
        </>
      )}
      {error && <span role="alert" className="text-red-700 dark:text-red-400">{error}</span>}
    </div>
  );
}
