"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Native <dialog>: focus trap, Escape to close and inert background come from the platform. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dlg-title" className="rounded-xl p-6 backdrop:bg-black/40">
      <h2 id="dlg-title" className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </dialog>
  );
}
