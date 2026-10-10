import { describe, expect, it } from "vitest";
import { buildIcs } from "./ics";

const base = {
  uid: "b1@papple", start: new Date("2027-01-04T09:30:00Z"), end: new Date("2027-01-04T10:00:00Z"),
  title: "Intro call", description: "", now: new Date("2026-12-01T08:00:00Z"),
};

describe("buildIcs", () => {
  it("writes one event with UTC times and CRLF line endings", () => {
    const ics = buildIcs(base);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20270104T093000Z\r\n");
    expect(ics).toContain("DTEND:20270104T100000Z\r\n");
    expect(ics).toContain("DTSTAMP:20261201T080000Z\r\n");
    expect(ics.split("\r\n").filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });
  it("escapes text so a note cannot add lines or properties", () => {
    const ics = buildIcs({ ...base, title: "A, B; C\\D", description: "a\r\nEND:VEVENT\r\nX" });
    expect(ics.split("\r\n").filter((l) => l === "END:VEVENT")).toHaveLength(1);
    expect(ics).toContain("SUMMARY:A\\, B\\; C\\\\D\r\n");
    expect(ics).toContain("DESCRIPTION:a\\nEND:VEVENT\\nX\r\n");
  });
  it("includes an https meeting link and drops anything else", () => {
    expect(buildIcs({ ...base, url: "https://meet.example/x" })).toContain("URL:https://meet.example/x\r\n");
    expect(buildIcs({ ...base, url: "javascript:alert(1)" })).not.toContain("URL:");
  });
  it("folds lines longer than 75 octets", () => {
    const ics = buildIcs({ ...base, description: "x".repeat(200) });
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).toContain("\r\n x");
  });
});
