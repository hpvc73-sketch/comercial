import { NextRequest, NextResponse } from "next/server";
import { getMonitorEngine } from "../../../../lib/monitorEngine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const engine = getMonitorEngine();
  engine.updateSettings(body);
  return NextResponse.json({ ok: true, state: engine.getState() });
}
