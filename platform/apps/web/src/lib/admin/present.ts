import { SETTINGS } from "./settings-registry";

export const VERIFIED_COPY = "Papple reviewed the evidence supplied by this provider. This is not a licence or credential check.";

export function formatSettingValue(key: string, value: unknown): string {
  const unit = SETTINGS[key]?.unit;
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") {
    if (unit === "bps") return `${Number((value / 100).toFixed(2))}%`;
    if (unit === "minutes") return `${value} minutes`;
    if (unit === "hours") return `${value} hours`;
    if (unit === "days") return `${value} days`;
    if (unit === "minor") return `${value} (minor units)`;
    return String(value);
  }
  return JSON.stringify(value);
}

const ACTIONS: Record<string, string> = {
  "admin.setting.set": "Setting changed",
  "admin.flag.set": "Feature flag changed",
  "admin.plan.update": "Plan updated",
  "admin.org.status": "Organization status changed",
  "admin.role.set": "Staff role changed",
  "verification.request": "Verification requested",
  "verification.review": "Verification reviewed",
  "verification.revoke": "Verification revoked",
  "dispute.resolve": "Dispute ruled",
  "marketplace.hide": "Item hidden",
  "marketplace.unhide": "Item restored",
  "moderation.dismiss": "Report dismissed",
  "admin.category.save": "Category saved",
  "admin.skill.save": "Skill saved",
};
export const describeAuditAction = (a: string) => ACTIONS[a] ?? a;
