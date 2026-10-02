/** Thrown by `send` when retrying can never help (invalid or rejected address). The row is retired instead of retried forever. */
export class PermanentEmailError extends Error {
  constructor() { super("recipient permanently undeliverable"); this.name = "PermanentEmailError"; }
}

export interface UnreadNotification { id: string; userEmail: string; type: string; link: string }

interface Deps {
  loadUnread: (olderThanMs: number) => Promise<UnreadNotification[]>;
  send: (m: { to: string; subject: string; text: string }) => Promise<void>;
  markEmailed: (ids: string[]) => Promise<void>;
  isEnabled: () => Promise<boolean>;
  delayMs: number;
}

const SUBJECTS: Record<string, string> = {
  message_received: "You have a new message on Papple",
  proposal_received: "You have a new proposal on Papple",
};
const FALLBACK_SUBJECT = "You have a new notification on Papple";

/** Emails a neutral nudge for notifications still unread after a delay. Bodies carry a link only: no message text, no amounts. */
export function createEmailNotifier(deps: Deps) {
  return {
    async run(): Promise<{ sent: number }> {
      if (!(await deps.isEnabled())) return { sent: 0 };
      const items = await deps.loadUnread(deps.delayMs);
      const done: string[] = [];
      const retired: string[] = [];
      for (const n of items) {
        try {
          await deps.send({
            to: n.userEmail,
            subject: SUBJECTS[n.type] ?? FALLBACK_SUBJECT,
            text: `You have something new waiting for you on Papple.\n\nOpen it here: ${n.link}\n\nYou received this because you have a Papple account.`,
          });
          done.push(n.id);
        } catch (e) {
          // One bad recipient must not block the rest. Transient failures stay un-emailed and retry next run;
          // permanent ones are retired so a pile of bad addresses can never occupy the whole batch.
          if (e instanceof PermanentEmailError) retired.push(n.id);
        }
      }
      if (done.length + retired.length > 0) await deps.markEmailed([...done, ...retired].sort());
      return { sent: done.length };
    },
  };
}
