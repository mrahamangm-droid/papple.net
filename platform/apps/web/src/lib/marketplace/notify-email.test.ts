import { describe, expect, it, vi } from "vitest";
import { PermanentEmailError, createEmailNotifier } from "./notify-email";

const item = (n: number, extra = {}) => ({ id: `n${n}`, userEmail: `u${n}@x.test`, type: "message_received", link: `https://papple.test/messages/c${n}`, ...extra });

function make(opts: { enabled?: boolean; items?: ReturnType<typeof item>[]; sendFails?: string[]; permanent?: string[] } = {}) {
  const loadUnread = vi.fn(async (_olderThanMs: number) => opts.items ?? [item(1), item(2)]);
  const send = vi.fn(async (m: { to: string; subject: string; text: string }) => {
    if (opts.permanent?.includes(m.to)) throw new PermanentEmailError();
    if (opts.sendFails?.includes(m.to)) throw new Error("smtp down");
  });
  const markEmailed = vi.fn(async (_ids: string[]) => undefined);
  const notifier = createEmailNotifier({ loadUnread, send, markEmailed, isEnabled: async () => opts.enabled ?? true, delayMs: 600_000 });
  return { loadUnread, send, markEmailed, notifier };
}

describe("email notifier", () => {
  it("sends nothing and reads nothing when the flag is off", async () => {
    const { notifier, loadUnread, send, markEmailed } = make({ enabled: false });
    expect(await notifier.run()).toEqual({ sent: 0 });
    expect(loadUnread).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(markEmailed).not.toHaveBeenCalled();
  });
  it("asks only for notifications older than the delay", async () => {
    const { notifier, loadUnread } = make();
    await notifier.run();
    expect(loadUnread).toHaveBeenCalledWith(600_000);
  });
  it("sends once per notification, then marks exactly those as emailed", async () => {
    const { notifier, send, markEmailed } = make();
    expect(await notifier.run()).toEqual({ sent: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(markEmailed).toHaveBeenCalledTimes(1);
    expect(markEmailed).toHaveBeenCalledWith(["n1", "n2"]);
  });
  it("a failing recipient does not block the others and is not marked", async () => {
    const { notifier, markEmailed, send } = make({ sendFails: ["u1@x.test"] });
    expect(await notifier.run()).toEqual({ sent: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(markEmailed).toHaveBeenCalledWith(["n2"]);
  });
  it("marks nothing when nothing was sent", async () => {
    const { notifier, markEmailed } = make({ items: [] });
    expect(await notifier.run()).toEqual({ sent: 0 });
    expect(markEmailed).not.toHaveBeenCalled();
  });
  it("bodies are neutral: a link, no message text, no amounts", async () => {
    const { notifier, send } = make({ items: [item(1, { type: "proposal_received", link: "https://papple.test/projects/p1", preview: "I will do it for $5,000", price: 500000 })] });
    await notifier.run();
    const m = send.mock.calls[0][0];
    expect(m.text).toContain("https://papple.test/projects/p1");
    expect(m.text + m.subject).not.toMatch(/5,000|500000|I will do it/);
    expect(m.subject.length).toBeGreaterThan(5);
  });
  it("uses distinct neutral subjects per type and a safe default", async () => {
    const { notifier, send } = make({ items: [item(1, { type: "message_received" }), item(2, { type: "proposal_received" }), item(3, { type: "weird" })] });
    await notifier.run();
    const subjects = send.mock.calls.map((c) => c[0].subject);
    expect(new Set(subjects.slice(0, 2)).size).toBe(2);
    expect(subjects[2]).toMatch(/notification/i);
  });
  it("stops retrying a permanently undeliverable recipient without counting it as sent", async () => {
    const { notifier, markEmailed } = make({ permanent: ["u1@x.test"] });
    expect(await notifier.run()).toEqual({ sent: 1 });
    expect(markEmailed).toHaveBeenCalledWith(["n1", "n2"]); // n1 retired so it cannot jam the queue, n2 delivered
  });
  it("keeps a transient failure for the next run", async () => {
    const { notifier, markEmailed } = make({ sendFails: ["u1@x.test"] });
    await notifier.run();
    expect(markEmailed).not.toHaveBeenCalledWith(expect.arrayContaining(["n1"]));
  });
});
