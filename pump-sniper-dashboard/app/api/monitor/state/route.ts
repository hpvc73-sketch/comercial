import { NextResponse } from "next/server";
import { getMonitorEngine } from "../../../../lib/monitorEngine";

export const dynamic = "force-dynamic";

export function GET() {
  const engine = getMonitorEngine();
  return NextResponse.json(engine.getState());
}
