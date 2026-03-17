import { NextResponse } from "next/server";
import { monitorEngine } from "../../../../lib/monitorEngine";

export function GET() {
  return NextResponse.json(monitorEngine.getState());
}
