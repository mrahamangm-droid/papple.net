import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border border-neutral-200 p-5 dark:border-neutral-800 ${className}`} {...props} />;
}
