import { describe, expect, it } from "vitest";
import { KIND_LABEL, canHide, categoryInput, dismissInput, hideInput, skillInput } from "./moderation";

const id = "11111111-1111-4111-8111-111111111111";
const reason = "A perfectly good reason";

describe("moderation inputs", () => {
  it("hide accepts profile, service and project but not message", () => {
    for (const kind of ["profile", "service", "project"]) expect(hideInput.safeParse({ kind, id, hidden: true, reason }).success).toBe(true);
    expect(hideInput.safeParse({ kind: "message", id, hidden: true, reason }).success).toBe(false);
    expect(hideInput.safeParse({ kind: "profile", id, hidden: "yes", reason }).success).toBe(false);
    expect(hideInput.safeParse({ kind: "profile", id, hidden: true, reason: "short" }).success).toBe(false);
  });
  it("dismiss needs a report id and a reason", () => {
    expect(dismissInput.safeParse({ reportId: id, reason }).success).toBe(true);
    expect(dismissInput.safeParse({ reportId: "x", reason }).success).toBe(false);
    expect(dismissInput.safeParse({ reportId: id, reason: "x".repeat(1001) }).success).toBe(false);
  });
  it("only profiles, services and projects can be hidden", () => {
    expect(canHide("project")).toBe(true);
    expect(canHide("message")).toBe(false);
    expect(KIND_LABEL.message).toBe("Message");
  });
});

describe("taxonomy inputs", () => {
  const cat = { id: null, slug: "web-design", name: "Web design", parentId: null, position: 3, active: true, reason };
  it("category bounds", () => {
    expect(categoryInput.safeParse(cat).success).toBe(true);
    expect(categoryInput.safeParse({ ...cat, slug: "Web Design" }).success).toBe(false);
    expect(categoryInput.safeParse({ ...cat, slug: "a" }).success).toBe(false);
    expect(categoryInput.safeParse({ ...cat, name: "x" }).success).toBe(false);
    expect(categoryInput.safeParse({ ...cat, position: -1 }).success).toBe(false);
    expect(categoryInput.safeParse({ ...cat, position: 1.5 }).success).toBe(false);
    expect(categoryInput.safeParse({ ...cat, id, slug: undefined }).success).toBe(true);
  });
  it("skill bounds", () => {
    const skill = { id: null, slug: "figma", name: "Figma", categoryId: id, active: true, reason };
    expect(skillInput.safeParse(skill).success).toBe(true);
    expect(skillInput.safeParse({ ...skill, categoryId: "nope" }).success).toBe(false);
    expect(skillInput.safeParse({ ...skill, name: "x".repeat(81) }).success).toBe(false);
  });
});
