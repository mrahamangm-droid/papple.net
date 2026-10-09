import { describe, expect, it, vi } from "vitest";
import { canAccessKey, createStorage, objectKey, orgIdFromKey } from "./storage";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";

describe("objectKey", () => {
  it("always prefixes the org id", () => {
    expect(objectKey(ORG, FILE, "pdf")).toBe(`orgs/${ORG}/${FILE}.pdf`);
  });
  it("rejects non-uuid ids and unknown extensions (no path traversal)", () => {
    expect(() => objectKey("../x", FILE, "pdf")).toThrow();
    expect(() => objectKey(ORG, "a/b", "pdf")).toThrow();
    expect(() => objectKey(ORG, FILE, "exe")).toThrow();
  });
});

describe("key ownership", () => {
  it("extracts the org id and checks membership", () => {
    const key = objectKey(ORG, FILE, "png");
    expect(orgIdFromKey(key)).toBe(ORG);
    expect(canAccessKey(key, [ORG])).toBe(true);
    expect(canAccessKey(key, [OTHER])).toBe(false);
    expect(canAccessKey(key, [])).toBe(false);
  });
  it("denies malformed keys", () => {
    expect(orgIdFromKey("orgs/../etc/passwd")).toBeNull();
    expect(canAccessKey("random/key", [ORG])).toBe(false);
    expect(canAccessKey(`orgs/${ORG}/../${OTHER}/${FILE}.pdf`, [ORG])).toBe(false);
  });
});

describe("createStorage", () => {
  it("caps signed URL lifetime at 300 seconds", async () => {
    const presignGet = vi.fn(async (_k: string, _ttl: number) => "https://signed");
    const s = createStorage({ presignGet, presignPut: vi.fn(async () => "https://put") });
    await s.signDownloadUrl(objectKey(ORG, FILE, "pdf"), 99999);
    expect(presignGet.mock.calls[0]![1]).toBe(300);
    await s.signDownloadUrl(objectKey(ORG, FILE, "pdf"));
    expect(presignGet.mock.calls[1]![1]).toBe(300);
    await s.signDownloadUrl(objectKey(ORG, FILE, "pdf"), 60);
    expect(presignGet.mock.calls[2]![1]).toBe(60);
  });
  it("refuses to sign a malformed key", async () => {
    const s = createStorage({ presignGet: async () => "x", presignPut: async () => "x" });
    await expect(s.signDownloadUrl("../../secret")).rejects.toThrow();
  });
  it("signs uploads bound to mime and size", async () => {
    const presignPut = vi.fn(async (_k: string, _m: string, _s: number, _ttl: number) => "https://put");
    const s = createStorage({ presignGet: async () => "x", presignPut });
    await s.signUploadUrl(objectKey(ORG, FILE, "pdf"), "application/pdf", 1234);
    expect(presignPut).toHaveBeenCalledWith(objectKey(ORG, FILE, "pdf"), "application/pdf", 1234, 300);
  });
});

import { verifyUploadedObject } from "./storage";

describe("verifyUploadedObject", () => {
  const key = objectKey(ORG, FILE, "png");
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0]);

  it("accepts an object whose stored bytes match the declared type and keeps it", async () => {
    const remove = vi.fn(async () => {});
    const r = await verifyUploadedObject({ readHead: async () => ({ head: PNG, size: 500 }), remove }, key, { name: "a.png", declaredMime: "image/png" });
    expect(r).toMatchObject({ ok: true, ext: "png" });
    expect(remove).not.toHaveBeenCalled();
  });
  it("deletes an object whose content does not match what was declared", async () => {
    const remove = vi.fn(async (_k: string) => {});
    const r = await verifyUploadedObject({ readHead: async () => ({ head: PDF, size: 500 }), remove }, key, { name: "a.png", declaredMime: "image/png" });
    expect(r).toMatchObject({ ok: false });
    expect(remove).toHaveBeenCalledWith(key);
  });
  it("deletes an object that exceeds the size cap and rejects a missing object", async () => {
    const remove = vi.fn(async (_k: string) => {});
    const big = await verifyUploadedObject({ readHead: async () => ({ head: PNG, size: 11 * 1024 * 1024 }), remove }, key, { name: "a.png", declaredMime: "image/png" });
    expect(big).toMatchObject({ ok: false });
    expect(remove).toHaveBeenCalledTimes(1);
    const missing = await verifyUploadedObject({ readHead: async () => null, remove }, key, { name: "a.png", declaredMime: "image/png" });
    expect(missing).toMatchObject({ ok: false });
  });
  it("deletes an object whose stored size is not the size that was registered", async () => {
    const remove = vi.fn(async (_k: string) => {});
    const r = await verifyUploadedObject({ readHead: async () => ({ head: PNG, size: 600 }), remove }, key, { name: "a.png", declaredMime: "image/png", expectedSize: 500 });
    expect(r).toEqual({ ok: false, reason: "file size does not match" });
    expect(remove).toHaveBeenCalledWith(key);
    const same = await verifyUploadedObject({ readHead: async () => ({ head: PNG, size: 500 }), remove: async () => {} }, key, { name: "a.png", declaredMime: "image/png", expectedSize: 500 });
    expect(same).toMatchObject({ ok: true });
  });
});
