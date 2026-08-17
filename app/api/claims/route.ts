import { NextResponse } from "next/server";
import { listClaims } from "@/lib/box";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ claims: await listClaims() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load claims" },
      { status: 500 },
    );
  }
}
