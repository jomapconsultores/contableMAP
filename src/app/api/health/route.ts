import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    servicio: "contable-map",
    hora: new Date().toISOString(),
  });
}
