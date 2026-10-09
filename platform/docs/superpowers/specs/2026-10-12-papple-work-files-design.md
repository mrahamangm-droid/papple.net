# PAPple Work and Files — design (Business OS slice 1)

## Goal
Both parties of a contract can track the work: tasks, private time records and shared documents. Each item is either private to its own organization or shared with the other party on that contract. The shared part is the client portal.

## Understanding
- Said: tasks, time records and files tied to contracts, org-private or shared, client sees only what is shared (user approved the written design; the "tasks without a contract", folders and versions options were offered and not chosen).
- Ruling: **every task and file belongs to a contract** (contract_id not null). The approved text said "may be tied"; the offered extra option "tasks without a contract" was declined, so standalone tasks stay out. Cost if wrong: one nullable column and a page.
- Success: a provider adds tasks and uploads a deliverable, shares them, and the client sees them on the contract page without seeing anything private; neither side can read the other's private items, even by calling the database directly.

## Non-goals (later)
Dependencies, Gantt, recurring tasks (automation slice), OCR and extraction (document AI slice), folders, file versions, retention rules, comments on tasks (messaging exists), client-visible time, per-task assignee outside the org, virus scanning (none exists; the UI does not claim it).

## Who can do what
- A contract has two sides: the client org and the provider org (`contracts.client_org_id`, `provider_org_id`).
- Write (create/edit tasks, log time, register files): owner, admin or member of a side's org, while the contract is not `cancelled`.
- Delete or change visibility of an item: its creator, or an owner or admin of the item's org.
- Read: members of the item's own org always. Members of the other side read only items with visibility `shared` (and files only when `ready`).
- Counterparty access is read-only. Platform staff access is out of scope (the admin console already reads disputes).

## Data (migration 0040)
- `tasks(id, contract_id, org_id, milestone_id null, title 1..200, description ≤2000, status todo|in_progress|blocked|done, priority low|normal|high, assignee_id null, due_date null, visibility private|shared default private, created_by, created_at, updated_at)`. `org_id` is a side of the contract (checked in the RPC). `milestone_id` must belong to the same contract. `assignee_id` must be a member of `org_id`.
- `time_entries(id, contract_id, org_id, task_id null, user_id, work_date, minutes 1..1440, note ≤300, created_at)`. Always private. A `task_id` must belong to the same contract and the same org.
- `contract_files(id, contract_id, org_id, name, mime, size_bytes, object_key unique, visibility private|shared default private, status pending|ready, uploaded_by, created_at, confirmed_at)`. `object_key` is `orgs/<org_id>/<id>.<ext>`, the existing storage layout, so the existing key helpers apply.
- RLS on, **no direct write grants**. Select policies: own org (`is_member(org_id)`), or visibility shared and (for files) status ready and the caller is a member of the other side of the contract. The `object_key` column is not selectable by clients (column grant); downloads go through an RPC.
- Limits (database settings like the other `limits.*`): `limits.tasks_per_contract` (default 50, professional_plus 200, business 1000, enterprise null), `limits.files_per_contract` (20 / 100 / 500 / null), `limits.storage_mb` per organization (100 / 1024 / 10240 / null; counts pending and ready files). The limit applies to the organization writing, using its own plan.
- Writes (all SECURITY DEFINER, explicit `p_org`, errcodes 42501 not allowed, 22023 invalid, 23505 duplicate, 54000 limit, audit rows): `task_save`, `task_set_status`, `task_delete`, `time_log`, `time_delete`, `file_register`, `file_confirm`, `file_set_visibility`, `file_delete`, and `file_authorize(p_file)` which returns `(object_key, name, mime)` for a permitted reader or raises 42501.
- Limit checks use advisory locks keyed by org or contract, as in earlier slices.
- Review additions: `task_set_visibility` (share toggle changes only that field), `file_pending_key` returns key, name, type and size to the file's own organization, `assignee_id` is not readable by clients (the other side sees the organization, not the person), `file_register` refuses a key a portfolio item already uses, and `file_set_visibility` / `file_confirm` refuse on a cancelled contract (deleting stays allowed so storage can be freed).

## Files flow
1. Server validates name, declared type and size with the existing `validateUpload`, generates the file id and key, and calls `file_register` (pending, counts against the limits).
2. Browser PUTs to the signed URL.
3. Server reads the key, name, type and size from the registered row (never from the browser) and runs `verifyUploadedObject` (bytes and exact size checked, bad objects deleted). Only then does it record the verification with the service role (`file_mark_verified`, executable by the service role only), and `file_confirm` refuses any file without that record. A failed verification deletes the pending row via `file_delete`. (Added after review: without the record a signed-in member could call the database directly, skip the server and share unchecked bytes.)
4. Download: a route handler calls `file_authorize`, then signs a five-minute URL. The existing `/api/files/sign` stays for org-owned files and is not changed.
5. Pending files older than 24 hours are not shown and are removable by their org; no automatic cleanup in this slice (listed as a known limit).

## Surfaces
- `/contracts/[id]/work`: Tasks, Time and Files sections for members of either side. Time is shown only to the owning org. Counterparty sees "Shared by <org>" items read-only.
- Link from the contract page. Plain error messages, never raw server text. Rate-limited actions (`work`: 60/min per user, `uploads` reused for file signing).
- Public pages and the API are unchanged. Nothing here is indexed.

## Tests
pgTAP: each RPC's authorization (owner/admin/member/outsider, both sides, cancelled contract), visibility (private invisible to the counterparty through select and through `file_authorize`), shared read-only for the counterparty, cross-contract references rejected (milestone, task, assignee), limits (tasks, files, storage) per plan, pending files never readable by the counterparty, direct table writes denied, object_key not selectable, audit rows. Race test: file and task limits under parallel creates. vitest: validators, presenters, services (gates, error mapping), the file route handler. e2e: anonymous gate on `/contracts/[id]/work` and the file route.

## Known limit: overwrite window
The signed upload URL lives five minutes and can PUT again. Within that window the uploader could overwrite a checked file with different bytes of the same size and type. The check is a type and size gate, not a malware scan (stated in the UI and the launch checklist). Fix later: copy the verified object to a key the signed URL cannot reach, or shorten the window.
