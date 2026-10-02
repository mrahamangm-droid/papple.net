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
        <p className="mt-2 text-sm">More Admin console modules are added in a later sub-project.</p>
      </Card>
    </AppShell>
  );
}
