"use client";

/** Printing is the PDF path for now: the browser's "Save as PDF" keeps the invoice exactly as shown. */
export function PrintButton() {
  return <button onClick={() => window.print()} className="rounded-md border border-neutral-400 px-3 py-1 text-sm">Print or save as PDF</button>;
}
