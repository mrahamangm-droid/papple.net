export type WorkFailure = "forbidden" | "invalid" | "limit" | "duplicate" | "rate" | "file" | "error";

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
const STATUS: Record<string, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" };
export const taskStatusLabel = (s: string): string => STATUS[s] ?? "Unknown";

const PRIORITY: Record<string, string> = { low: "Low", normal: "Normal", high: "High" };
export const priorityLabel = (p: string): string => PRIORITY[p] ?? "Normal";

export const visibilityLabel = (v: string): string => (v === "shared" ? "Shared with the other party" : "Private to your organization");

/** 90 -> "1 h 30 min", 45 -> "45 min", 120 -> "2 h". */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const MESSAGES: Record<WorkFailure, string> = {
  forbidden: "You do not have permission to do that. Only members of the two organizations on this contract can work here, and a cancelled contract is read-only.",
  invalid: "Some details are missing or not valid. Check the title, date, minutes (1 to 1440) and that the item still exists.",
  limit: "A plan limit was reached: tasks or files for this contract, or storage for your organization. Remove something or upgrade your plan.",
  duplicate: "That already exists.",
  rate: "You are going a little fast. Wait a moment and try again.",
  file: "That file cannot be uploaded. Use a PDF, PNG, JPG, WebP, DOCX or XLSX under 10 MB.",
  error: "Something went wrong. Please try again.",
};
export const workFailureMessage = (code: WorkFailure): string => MESSAGES[code] ?? MESSAGES.error;
