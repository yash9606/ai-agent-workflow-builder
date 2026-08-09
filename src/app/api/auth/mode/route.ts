import { resolveAuthMode } from "@/lib/auth/mode";

export const runtime = "nodejs";

/** Public auth-mode probe for the login UI (no secrets). */
export async function GET() {
  const info = resolveAuthMode();
  return Response.json({
    mode: info.mode,
    demoEnabled: info.demoEnabled,
    nhostConfigured: info.nhostConfigured,
    productionNhostForced: info.productionNhostForced,
  });
}
