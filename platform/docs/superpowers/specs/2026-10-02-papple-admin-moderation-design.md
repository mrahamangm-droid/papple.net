# PAPple Admin console, slice 2: moderation, taxonomy, overview — design

Status: design approved by the owner on 2026-10-02 ("1, 2": approve and build; changes, if any, to follow in a later message). Builds on slice 1 (`2026-10-02-papple-admin-console-design.md`).

## Rules for every write
Admin or staff as stated, `aal2` in the database and in the server action, reason 10 to 1,000 characters, one `audit_log` row containing the reason. Errcodes 42501 (not allowed or no second factor) and 22023 (invalid). Screens are admin-only for now (the app's `platform.admin` capability); the database functions accept support staff where noted so a later support screen needs no migration.

## 1. Moderation
- `moderation_queue(p_limit int default 50)`: staff + aal2, returns open reports oldest first with `report_id, target_kind, target_id, reason, created_at, open_count` (open reports on the same target), `target_label` (profile headline, service title, project title, or the first 200 characters of a reported message) and `target_status`.
- `hidden_items(p_limit int default 100)`: staff + aal2, profiles, services and projects currently `hidden_by_admin`, with label and kind.
- `admin_set_visibility(p_kind, p_id, p_hidden, p_reason)` (exists): now requires a 10 to 1,000 character reason. Hiding marks that target's open reports `actioned`.
- `dismiss_report(p_report uuid, p_reason text)`: staff + aal2, only an `open` report, sets `dismissed`, audited as `moderation.dismiss`.
- Screens: `/admin/reports` (queue with Hide and Dismiss forms), `/admin/reports/hidden` (list with Restore). Message reports can be dismissed but not hidden (messages are not hideable); the screen says so.

## 2. Taxonomy
- `admin_save_category(p_id uuid, p_slug text, p_name text, p_parent uuid, p_position int, p_active boolean, p_reason text) returns uuid` and `admin_save_skill(p_id uuid, p_slug text, p_name text, p_category uuid, p_active boolean, p_reason text) returns uuid`: admin + aal2. A null `p_id` creates; otherwise updates name, parent or category, position and active. The slug is set on create and never changes. A category cannot be its own parent or create a cycle (depth limited to 2 levels). Never deletes.
- Deactivating hides an item from new use; existing profiles and services keep it.
- The direct admin write policies and write grants on `categories` and `skills` are removed.
- Screen: `/admin/taxonomy`.

## 3. Overview
`/admin` shows counts (open disputes, open reports, pending verifications, suspended organizations) and the last 10 audit entries, each linking to its screen. Counts come from the admin's own session (RLS).

## Out of scope
Moderating conversations, bulk actions, automated abuse scoring, a support-staff screen.

## Review focus
Hiding a target that has no reports; dismissing a report twice; a category parent cycle; reactivating a skill under an inactive category; a message report shown to someone without aal2; slug collisions on create.
