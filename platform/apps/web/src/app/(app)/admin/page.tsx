import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { requireCapability } from "@/lib/auth-context";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const ctx = await requireCapability("platform.admin");
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Admin</h1>
      <Card className="mt-6">
        <p className="text-sm"><Link className="underline" href="/admin/disputes">Open disputes</Link> — rule on disputes and refund clients.</p>
        <p className="mt-2 text-sm"><Link className="underline" href="/admin/settings">Settings and flags</Link> — fees, limits and switches.</p>
        <p className="mt-2 text-sm"><Link className="underline" href="/admin/plans">Plans</Link> — names, prices, limits and features.</p>
        <p className="mt-2 text-sm"><Link className="underline" href="/admin/audit">Audit log</Link> — who changed what, and why.</p>
        <p className="mt-2 text-sm"><Link className="underline" href="/admin/organizations">Organizations</Link> — suspend or restore.</p>
        <p className="mt-2 text-sm"><Link className="underline" href="/admin/staff">Staff</Link> — admin and support roles.</p>
        <p className="mt-2 text-sm"><Link className="underline" href="/admin/verification">Verification</Link> — review provider evidence.</p>
      </Card>
    </AppShell>
  );
}
