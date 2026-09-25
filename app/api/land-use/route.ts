import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDashboardFor } from "@/lib/data/repository";
import { adviseLandUse, LandInputError } from "@/lib/land/advisor";
import { LandRequestSchema, type LandResponse } from "@/lib/land/contract";

/** Live research searches the web and then structures the findings: allow up to two minutes. */
export const maxDuration = 120;

/**
 * POST /api/land-use — { farm_id | lat+lng, area_ha, water_source, water_ec_dS_m?, budget, research? }
 * → { report }. Ranks what the land could be used for (rules), adjusted by live Claude research on
 * Qatar's markets and news when ANTHROPIC_API_KEY is set.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in to use the land-use advisor." }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }
  const parsed = LandRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  try {
    const data = await getDashboardFor(user);
    const report = await adviseLandUse(parsed.data, data, { research: true });
    return NextResponse.json({ report } satisfies LandResponse);
  } catch (error) {
    if (error instanceof LandInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[land] Advisor failed:", error);
    return NextResponse.json({ error: "The land-use analysis failed. Try again in a minute." }, { status: 500 });
  }
}
