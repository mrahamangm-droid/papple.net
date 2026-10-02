import { ALLOWED_EXTS, MAX_UPLOAD_BYTES, validateUpload, type UploadCheck } from "./file-validation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^orgs\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.([a-z0-9]{2,5})$/i;
export const MAX_SIGN_TTL_SEC = 300;

export function objectKey(orgId: string, fileId: string, ext: string): string {
  if (!UUID.test(orgId) || !UUID.test(fileId)) throw new Error("invalid id");
  if (!ALLOWED_EXTS.includes(ext)) throw new Error("invalid extension");
  return `orgs/${orgId}/${fileId}.${ext}`;
}

export function orgIdFromKey(key: string): string | null {
  const m = KEY.exec(key);
  return m && UUID.test(m[1]!) && UUID.test(m[2]!) ? m[1]!.toLowerCase() : null;
}

export function canAccessKey(key: string, memberOrgIds: string[]): boolean {
  const org = orgIdFromKey(key);
  return !!org && memberOrgIds.some((id) => id.toLowerCase() === org);
}

export interface StorageDeps {
  presignGet: (key: string, ttlSec: number) => Promise<string>;
  presignPut: (key: string, mime: string, size: number, ttlSec: number) => Promise<string>;
}

const clamp = (ttl: number) => Math.min(Math.max(1, Math.floor(ttl)), MAX_SIGN_TTL_SEC);

export function createStorage(deps: StorageDeps) {
  const assertKey = (key: string) => { if (!orgIdFromKey(key)) throw new Error("invalid object key"); };
  return {
    async signDownloadUrl(key: string, ttlSec = MAX_SIGN_TTL_SEC) {
      assertKey(key);
      return deps.presignGet(key, clamp(ttlSec));
    },
    async signUploadUrl(key: string, mime: string, size: number, ttlSec = MAX_SIGN_TTL_SEC) {
      assertKey(key);
      return deps.presignPut(key, mime, size, clamp(ttlSec));
    },
  };
}

export interface VerifyDeps {
  readHead: (key: string, bytes: number) => Promise<{ head: Uint8Array; size: number } | null>;
  remove: (key: string) => Promise<void>;
}

/** After a direct-to-R2 upload: re-check the stored bytes and size; delete the object if it fails. */
export async function verifyUploadedObject(
  deps: VerifyDeps,
  key: string,
  declared: { name: string; declaredMime: string },
): Promise<UploadCheck> {
  const stored = await deps.readHead(key, 16);
  if (!stored) return { ok: false, reason: "object not found" };
  const check = stored.size > MAX_UPLOAD_BYTES
    ? ({ ok: false, reason: "file exceeds 10 MB" } as const)
    : validateUpload({ name: declared.name, size: stored.size, declaredMime: declared.declaredMime, head: stored.head });
  if (!check.ok) await deps.remove(key);
  return check;
}
