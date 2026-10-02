export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

interface TypeRule { mime: string; exts: string[]; canonicalExt: string; magic: (h: Uint8Array) => boolean }

const startsWith = (h: Uint8Array, sig: number[]) => sig.every((b, i) => h[i] === b);
const ZIP = (h: Uint8Array) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]);

const RULES: TypeRule[] = [
  { mime: "application/pdf", exts: ["pdf"], canonicalExt: "pdf", magic: (h) => startsWith(h, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  { mime: "image/png", exts: ["png"], canonicalExt: "png", magic: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mime: "image/jpeg", exts: ["jpg", "jpeg"], canonicalExt: "jpg", magic: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  {
    mime: "image/webp", exts: ["webp"], canonicalExt: "webp",
    magic: (h) => startsWith(h, [0x52, 0x49, 0x46, 0x46]) && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50,
  },
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", exts: ["docx"], canonicalExt: "docx", magic: ZIP },
  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", exts: ["xlsx"], canonicalExt: "xlsx", magic: ZIP },
];

export const ALLOWED_EXTS: readonly string[] = RULES.map((r) => r.canonicalExt);

const DANGEROUS = new Set(["exe", "bat", "cmd", "com", "scr", "js", "mjs", "jar", "sh", "ps1", "msi", "vbs", "html", "htm", "svg", "php", "dll", "apk", "app"]);

export type UploadCheck = { ok: true; ext: string; mime: string } | { ok: false; reason: string };

type Meta = { name: string; size: number; declaredMime: string };

function checkMeta(meta: Meta): { ok: false; reason: string } | { ok: true; ext: string; mime: string; rule: TypeRule } {
  const { name, size, declaredMime } = meta;
  if (!Number.isInteger(size) || size <= 0) return { ok: false, reason: "empty file" };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, reason: "file exceeds 10 MB" };
   
  if (!name || /[\\/\u0000-\u001f]/.test(name) || name.startsWith(".")) return { ok: false, reason: "invalid file name" };
  const parts = name.toLowerCase().split(".");
  if (parts.length < 2) return { ok: false, reason: "missing extension" };
  const ext = parts[parts.length - 1]!;
  if (parts.slice(1, -1).some((p) => DANGEROUS.has(p))) return { ok: false, reason: "suspicious double extension" };
  const rule = RULES.find((r) => r.mime === declaredMime.toLowerCase());
  if (!rule) return { ok: false, reason: "file type not allowed" };
  if (!rule.exts.includes(ext)) return { ok: false, reason: "extension does not match file type" };
  return { ok: true, ext: rule.canonicalExt, mime: rule.mime, rule };
}

/** Everything that can be checked from the declaration alone (used before issuing an upload URL). */
export function validateUploadMeta(meta: Meta): UploadCheck {
  const m = checkMeta(meta);
  return m.ok ? { ok: true, ext: m.ext, mime: m.mime } : m;
}

/** Full check including the file's leading bytes (magic number). */
export function validateUpload(meta: Meta & { head: Uint8Array }): UploadCheck {
  const m = checkMeta(meta);
  if (!m.ok) return m;
  if (!m.rule.magic(meta.head)) return { ok: false, reason: "file content does not match its type" };
  return { ok: true, ext: m.ext, mime: m.mime };
}
