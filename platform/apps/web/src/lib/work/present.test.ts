import { describe, expect, it } from "vitest";
import { formatBytes, formatMinutes, priorityLabel, taskStatusLabel, visibilityLabel, workFailureMessage } from "./present";

describe("work presenters", () => {
  it("formats minutes", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(-5)).toBe("0 min");
  });
  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("labels", () => {
    expect(taskStatusLabel("in_progress")).toBe("In progress");
    expect(taskStatusLabel("zzz")).toBe("Unknown");
    expect(priorityLabel("high")).toBe("High");
    expect(visibilityLabel("shared")).toMatch(/other party/);
    expect(visibilityLabel("private")).toMatch(/Private/);
  });
  it("never leaks raw errors", () => {
    expect(workFailureMessage("limit")).toMatch(/plan limit/);
    expect(workFailureMessage("bogus" as never)).toBe("Something went wrong. Please try again.");
  });
});
