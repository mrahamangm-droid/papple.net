import { describe, expect, it } from "vitest";
import { validateUpload } from "./file-validation";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

const ok = (name: string, mime: string, head: Uint8Array, size = 1000) => validateUpload({ name, size, declaredMime: mime, head });

describe("validateUpload", () => {
  it("accepts valid files whose magic bytes match the declared type", () => {
    expect(ok("a.png", "image/png", PNG)).toEqual({ ok: true, ext: "png", mime: "image/png" });
    expect(ok("a.jpg", "image/jpeg", JPG)).toMatchObject({ ok: true, ext: "jpg" });
    expect(ok("a.jpeg", "image/jpeg", JPG)).toMatchObject({ ok: true, ext: "jpg" });
    expect(ok("a.webp", "image/webp", WEBP)).toMatchObject({ ok: true, ext: "webp" });
    expect(ok("a.pdf", "application/pdf", PDF)).toMatchObject({ ok: true, ext: "pdf" });
    expect(ok("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ZIP)).toMatchObject({ ok: true, ext: "docx" });
    expect(ok("a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ZIP)).toMatchObject({ ok: true, ext: "xlsx" });
  });
  it("rejects a PDF labelled as PNG (magic bytes mismatch)", () => {
    expect(ok("a.png", "image/png", PDF)).toMatchObject({ ok: false });
  });
  it("rejects when the filename extension disagrees with the declared mime", () => {
    expect(ok("a.pdf", "image/png", PNG)).toMatchObject({ ok: false });
  });
  it("rejects double extensions such as invoice.pdf.exe and invoice.exe.pdf", () => {
    expect(ok("invoice.pdf.exe", "application/pdf", PDF)).toMatchObject({ ok: false });
    expect(ok("invoice.exe.pdf", "application/pdf", PDF)).toMatchObject({ ok: false });
  });
  it("rejects disallowed types (svg, html, exe) even with matching declarations", () => {
    expect(ok("a.svg", "image/svg+xml", bytes(0x3c, 0x73, 0x76, 0x67))).toMatchObject({ ok: false });
    expect(ok("a.html", "text/html", bytes(0x3c, 0x68))).toMatchObject({ ok: false });
  });
  it("enforces the 10 MB cap exactly", () => {
    expect(ok("a.pdf", "application/pdf", PDF, 10 * 1024 * 1024)).toMatchObject({ ok: true });
    expect(ok("a.pdf", "application/pdf", PDF, 10 * 1024 * 1024 + 1)).toMatchObject({ ok: false });
    expect(ok("a.pdf", "application/pdf", PDF, 0)).toMatchObject({ ok: false });
  });
  it("rejects path separators, null bytes and empty names", () => {
    expect(ok("../a.pdf", "application/pdf", PDF)).toMatchObject({ ok: false });
    expect(ok("a\\b.pdf", "application/pdf", PDF)).toMatchObject({ ok: false });
    expect(ok("a\u0000.pdf", "application/pdf", PDF)).toMatchObject({ ok: false });
    expect(ok("", "application/pdf", PDF)).toMatchObject({ ok: false });
  });
  it("is case-insensitive about the extension", () => {
    expect(ok("A.PDF", "application/pdf", PDF)).toMatchObject({ ok: true, ext: "pdf" });
  });
});

import { validateUploadMeta } from "./file-validation";

describe("validateUploadMeta (pre-sign, no bytes available)", () => {
  it("accepts well-formed declarations and rejects bad ones without needing magic bytes", () => {
    expect(validateUploadMeta({ name: "a.pdf", size: 10, declaredMime: "application/pdf" })).toEqual({ ok: true, ext: "pdf", mime: "application/pdf" });
    expect(validateUploadMeta({ name: "a.pdf.exe", size: 10, declaredMime: "application/pdf" })).toMatchObject({ ok: false });
    expect(validateUploadMeta({ name: "a.pdf", size: 10 * 1024 * 1024 + 1, declaredMime: "application/pdf" })).toMatchObject({ ok: false });
    expect(validateUploadMeta({ name: "a.svg", size: 10, declaredMime: "image/svg+xml" })).toMatchObject({ ok: false });
  });
});
