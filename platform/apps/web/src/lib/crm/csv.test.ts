import { describe, expect, it } from "vitest";
import { parseContactsCsv } from "./csv";

const ok = (text: string) => { const r = parseContactsCsv(text); if (!r.ok) throw new Error(r.code); return r; };

describe("parseContactsCsv", () => {
  it("maps common header names case-insensitively and reports file line numbers", () => {
    const r = ok("Full Name,E-mail,Organisation,Mobile\nSara Khan,sara@x.test,Khan Co,+97150\nLee,lee@x.test,,\n");
    expect(r.rows).toEqual([
      { line: 2, name: "Sara Khan", email: "sara@x.test", company: "Khan Co", phone: "+97150" },
      { line: 3, name: "Lee", email: "lee@x.test", company: "", phone: "" },
    ]);
  });
  it("handles quotes, doubled quotes, commas and newlines inside cells", () => {
    const r = ok('name,company\n"Khan, Sara","He said ""hi""\nthere"\n');
    expect(r.rows[0]).toMatchObject({ name: "Khan, Sara", company: 'He said "hi"\nthere' });
  });
  it("strips a byte order mark and accepts CRLF, semicolons and tabs", () => {
    expect(ok("﻿name;email\r\nA;a@x.test\r\n").rows[0]).toMatchObject({ name: "A", email: "a@x.test" });
    expect(ok("name\temail\nB\tb@x.test").rows[0]).toMatchObject({ name: "B", email: "b@x.test" });
  });
  it("skips blank lines but keeps real line numbers", () => {
    const r = ok("name\n\nA\n\nB\n");
    expect(r.rows.map((x) => [x.line, x.name])).toEqual([[3, "A"], [5, "B"]]);
  });
  it("keeps cells that look like spreadsheet formulas unchanged (never evaluated or rewritten)", () => {
    expect(ok("name\n=HYPERLINK(\"http://x\")\n").rows[0]!.name).toBe('=HYPERLINK("http://x")');
  });
  it("requires a name column and at least one data row", () => {
    expect(parseContactsCsv("email,phone\na@x.test,1\n")).toEqual({ ok: false, code: "no_name_column" });
    expect(parseContactsCsv("name,email\n")).toEqual({ ok: false, code: "empty" });
    expect(parseContactsCsv("")).toEqual({ ok: false, code: "empty" });
  });
  it("refuses unterminated quotes, oversized files and too many rows", () => {
    expect(parseContactsCsv('name\n"oops\n')).toEqual({ ok: false, code: "bad_format" });
    expect(parseContactsCsv("name\n" + "a".repeat(512 * 1024 + 1))).toEqual({ ok: false, code: "too_big" });
    expect(parseContactsCsv("name\n" + Array.from({ length: 501 }, (_, i) => `n${i}`).join("\n"))).toEqual({ ok: false, code: "too_many_rows" });
    expect(ok("name\n" + Array.from({ length: 500 }, (_, i) => `n${i}`).join("\n")).rows).toHaveLength(500);
  });
  it("trims cells and ignores extra columns", () => {
    expect(ok("name,email,notes\n  Ann  , ann@x.test ,ignored\n").rows[0]).toMatchObject({ name: "Ann", email: "ann@x.test" });
  });
});
