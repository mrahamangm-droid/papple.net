export interface ContactRow { line: number; name: string; email: string; company: string; phone: string }
export type CsvResult =
  | { ok: true; rows: ContactRow[] }
  | { ok: false; code: "empty" | "too_big" | "too_many_rows" | "bad_format" | "no_name_column" };

export const CSV_MAX_BYTES = 512 * 1024;
export const CSV_MAX_ROWS = 500;

const ALIASES: Record<"name" | "email" | "company" | "phone", string[]> = {
  name: ["name", "full name", "fullname", "contact", "contact name"],
  email: ["email", "e-mail", "email address", "mail"],
  company: ["company", "organization", "organisation", "business"],
  phone: ["phone", "mobile", "tel", "telephone", "phone number"],
};

/** RFC 4180 records with the delimiter taken from the header line. `line` is the physical line a record starts on. */
function records(text: string): { fields: string[]; line: number }[] | null {
  const first = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const count = (d: string) => { let n = 0, q = false; for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch === d) n++; } return n; };
  const delim = ([",", ";", "\t"] as const).reduce((best, d) => (count(d) > count(best) ? d : best), ",");
  const out: { fields: string[]; line: number }[] = [];
  let fields: string[] = [], cell = "", quoted = false, line = 1, start = 1, i = 0;
  const endRecord = () => { fields.push(cell); out.push({ fields, line: start }); fields = []; cell = ""; };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === "") { quoted = true; i++; continue; }
    if (ch === delim) { fields.push(cell); cell = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord(); line++; start = line; i++; continue;
    }
    cell += ch; i++;
  }
  if (quoted) return null;
  if (cell !== "" || fields.length) endRecord();
  return out;
}

export function parseContactsCsv(input: string): CsvResult {
  if (new TextEncoder().encode(input).length > CSV_MAX_BYTES) return { ok: false, code: "too_big" };
  const text = input.replace(/^﻿/, "");
  if (text.trim() === "") return { ok: false, code: "empty" };
  const recs = records(text);
  if (!recs) return { ok: false, code: "bad_format" };
  const header = recs[0]!.fields.map((h) => h.trim().toLowerCase());
  const col = (k: keyof typeof ALIASES) => header.findIndex((h) => ALIASES[k].includes(h));
  const idx = { name: col("name"), email: col("email"), company: col("company"), phone: col("phone") };
  if (idx.name < 0) return { ok: false, code: "no_name_column" };
  const rows: ContactRow[] = [];
  for (const r of recs.slice(1)) {
    if (r.fields.every((f) => f.trim() === "")) continue;
    const get = (i: number) => (i >= 0 ? (r.fields[i] ?? "").trim() : "");
    rows.push({ line: r.line, name: get(idx.name), email: get(idx.email), company: get(idx.company), phone: get(idx.phone) });
    if (rows.length > CSV_MAX_ROWS) return { ok: false, code: "too_many_rows" };
  }
  return rows.length === 0 ? { ok: false, code: "empty" } : { ok: true, rows };
}
