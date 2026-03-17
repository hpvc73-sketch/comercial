import { NextRequest, NextResponse } from "next/server";
import { monitorEngine } from "../../../../lib/monitorEngine";

export async function POST(req: NextRequest) {
  const body = await req.json();
  monitorEngine.updateSettings(body);
  return NextResponse.json({ ok: true, state: monitorEngine.getState() });
}
