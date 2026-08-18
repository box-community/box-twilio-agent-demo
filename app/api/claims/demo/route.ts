import { NextResponse } from "next/server";
import { saveClaimToBox } from "@/lib/box";
import { demoTranscript, newDemoClaim } from "@/lib/mock-data";
import { extractClaim } from "@/lib/openai";

export const maxDuration = 60;

export async function POST() {
  try {
    const claim = process.env.OPENAI_API_KEY
      ? await extractClaim(demoTranscript, { phone: "503-555-0148", claimantName: "Maya Thompson" })
      : newDemoClaim();
    const saved = await saveClaimToBox(claim);
    return NextResponse.json({ claim: saved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to process demo call" },
      { status: 500 },
    );
  }
}
