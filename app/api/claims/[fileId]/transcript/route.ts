import { NextResponse } from "next/server";
import { getClaimTranscript } from "@/lib/box";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  try {
    const { fileId } = await params;
    return NextResponse.json({ transcript: await getClaimTranscript(fileId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load transcript";
    return NextResponse.json(
      { error: message },
      { status: message === "Invalid Box file ID" ? 400 : 500 },
    );
  }
}
