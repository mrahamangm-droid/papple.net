# Migrations
Forward-only. Each migration lists an undo note for emergency manual rollback (prefer a new forward migration).

| Migration | Undo note |
|---|---|
| 0001_identity_tenancy | drop trigger on_auth_user_created; drop functions; drop tables memberships, organizations, profiles, platform_roles (destroys data) |
| 0002_config | drop tables feature_flag_overrides, feature_flags, settings_history, platform_settings, plans; drop function platform_settings_audit |
| 0003_audit | drop table audit_log; drop function audit_log_immutable (destroys audit trail — do not do in prod) |
| 0004_webhook_events | drop table webhook_events |
| 0005_guards | drop trigger memberships_keep_owner; drop function memberships_keep_owner; restore create_organization from 0001 |
