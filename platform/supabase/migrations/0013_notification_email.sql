-- Marks notifications already sent by email. Only trusted server code (service role) may set it:
-- authenticated users have SELECT on notifications and nothing else, so they cannot write this column.
alter table public.notifications add column emailed_at timestamptz;

-- The notifier scans for unread, not-yet-emailed rows older than a delay; keep that scan cheap.
create index notifications_email_pending_idx on public.notifications (created_at)
  where read_at is null and emailed_at is null;
