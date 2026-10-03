# PAPple plans and billing Implementation Plan

> Execution: superpowers:executing-plans (inline), by owner delegation.

**Goal:** Subscriptions drive `org_plan_key()`; owner-only checkout and portal; webhook-driven state.
**Spec:** docs/superpowers/specs/2026-10-04-papple-billing-design.md

## Global Constraints
Only verified webhooks write state. Out-of-order events ignored. Errcodes 42501/22023. No Stripe ids to members.

## Review Focus
See spec.

### Task 1: Database (0031_billing.sql + pgTAP 031)
- [ ] RED then GREEN: plan resolution (active, trialing, past_due in/out of grace, canceled, inactive plan), apply_subscription_event (applied/stale/unknown_org/unknown_plan, out-of-order), can_manage_billing, plan_feature, no user write or Stripe-id read, service-role-only RPCs.
### Task 2: Provider events + webhook + billing provider (vitest)
- [ ] subscription event parsing, handler routing and alerts, billing provider calls.
### Task 3: Billing service, actions, page, wiring
- [ ] owner-only, rate limit, duplicate guard, URL host check; page; registry setting.
### Task 4: Admin org view, docs, checklist, full verification
