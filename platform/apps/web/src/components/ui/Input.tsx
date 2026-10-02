import type { InputHTMLAttributes } from "react";

export function Input({ label, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-sm">
      {label}
      <input
        className={`mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600 ${className}`}
        {...props}
      />
    </label>
  );
}
