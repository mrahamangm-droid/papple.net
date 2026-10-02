export interface MessageRow { id: string; senderName: string; mine: boolean; body: string; createdAt: string }

/** Bodies are rendered as React text children, so markup in a message can never execute. */
export function MessageList({ messages }: { messages: MessageRow[] }) {
  if (messages.length === 0) return <p role="status" className="text-sm">No messages yet.</p>;
  return (
    <ol className="space-y-3" aria-label="Messages">
      {messages.map((m) => (
        <li key={m.id} className={`max-w-xl rounded-lg border p-3 text-sm ${m.mine ? "ml-auto border-blue-300" : "border-neutral-200 dark:border-neutral-800"}`}>
          <p className="text-xs opacity-70">{m.mine ? "You" : m.senderName} · <time dateTime={m.createdAt}>{new Date(m.createdAt).toUTCString()}</time></p>
          <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
