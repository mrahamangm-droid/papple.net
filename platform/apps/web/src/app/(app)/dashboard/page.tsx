import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { Card } from "@/components/ui/Card";
import { getAuthContext, requireCapability } from "@/lib/auth-context";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const maybe = await getAuthContext();
  if (maybe && maybe.memberships.length === 0) redirect("/onboarding");
  const ctx = await requireCapability("org.read");
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Card className="mt-6">
        <p className="text-sm">Account type: {ctx.persona ?? "not set"}</p>
        <p className="mt-1 text-sm">Marketplace tools arrive in the next releases.</p>
      </Card>
    </AppShell>
  );
}
