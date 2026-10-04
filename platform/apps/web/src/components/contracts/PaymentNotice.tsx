/** Sets expectations on every contract: payment happens at approval, never in advance, and Papple holds no funds. */
export function PaymentNotice({ side }: { side: "client" | "provider" }) {
  return (
    <p role="note" className="rounded-md border border-neutral-300 p-3 text-sm dark:border-neutral-700">
      {side === "client"
        ? "You pay each milestone when you approve it. Payment goes through Stripe straight to the professional; Papple does not hold your money."
        : "You are paid milestone by milestone, after the client approves each one. Payment goes straight to your own payout account through Stripe; Papple does not hold funds."}
    </p>
  );
}
