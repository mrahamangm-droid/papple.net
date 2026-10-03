import { LEGAL } from "@/lib/legal";
import { buildSecurityTxt } from "@/lib/security-txt";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(buildSecurityTxt(LEGAL.securityContact), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
