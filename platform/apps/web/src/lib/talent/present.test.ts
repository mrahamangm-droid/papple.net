import { describe, expect, it } from "vitest";
import { availabilityLabel, inviteNotificationCopy, inviteStatusLabel, parseTags, talentFailureMessage, type TalentFailure } from "./present";

describe("parseTags", () => {
  it("splits on commas, trims, lower-cases and de-duplicates", () => {
    expect(parseTags(" Rust, go ,RUST,, ")).toEqual(["rust", "go"]);
  });
  it("returns an empty list for blank input", () => {
    expect(parseTags("  ")).toEqual([]);
  });
});

describe("labels", () => {
  it("labels availability and falls back safely", () => {
    expect(availabilityLabel("available")).toBe("Available");
    expect(availabilityLabel("limited")).toBe("Limited availability");
    expect(availabilityLabel("unavailable")).toBe("Unavailable");
    expect(availabilityLabel("weird")).toBe("Unknown");
  });
  it("labels invitation status", () => {
    expect(inviteStatusLabel("sent")).toBe("Waiting for your answer");
    expect(inviteStatusLabel("declined")).toBe("You declined");
    expect(inviteStatusLabel("zzz")).toBe("Waiting for your answer");
  });
});

describe("talentFailureMessage", () => {
  it("has a distinct, plain message for every failure", () => {
    const codes: TalentFailure[] = ["forbidden", "invalid", "limit", "duplicate", "rate", "error"];
    const messages = codes.map(talentFailureMessage);
    expect(new Set(messages).size).toBe(codes.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(10);
  });
  it("never leaks server text for an unknown code", () => {
    expect(talentFailureMessage("nope" as TalentFailure)).toBe(talentFailureMessage("error"));
  });
});

describe("inviteNotificationCopy", () => {
  it("names the organization and project and links to the inbox", () => {
    expect(inviteNotificationCopy("project_invite", { from: "Acme", project_title: "Logo" })).toEqual({ text: 'Acme invited you to "Logo".', href: "/invitations" });
  });
  it("falls back safely when the payload is odd", () => {
    expect(inviteNotificationCopy("project_invite", { from: 5, project_title: null })).toEqual({ text: "You have a new project invitation.", href: "/invitations" });
  });
  it("ignores other notification types", () => {
    expect(inviteNotificationCopy("message_received", {})).toBeNull();
  });
});
