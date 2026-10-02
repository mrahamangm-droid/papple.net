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
      <Card className="mt-6"><p className="text-sm">Admin console modules are added in the Admin sub-project.</p></Card>
    </AppShell>
  );
}
