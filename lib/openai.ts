import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { claimIntakeSchema, type Claim, type TranscriptTurn } from "@/lib/types";

const CLAIM_PROMPT = `You are an experienced property-insurance intake analyst.
Extract the factual first notice of loss from the call transcript.

Rules:
- Be factual and conservative. Never invent a fact that the caller did not provide.
- Do not analyze coverage or infer policy terms. Box AI performs policy analysis later.
- Keep notes short and useful to a human adjuster.
- Normalize the loss date as YYYY-MM-DD when possible; otherwise use "Not provided".
- Phone, address, and claimant name may be "Not provided".`;

export async function extractClaim(
  transcript: TranscriptTurn[],
  defaults: Partial<Pick<Claim, "phone" | "claimantName">> = {},
): Promise<Omit<Claim, "boxFileId" | "boxUrl">> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to analyze a live call");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const renderedTranscript = transcript
    .map((turn) => `${turn.role === "caller" ? "Caller" : "Agent"}: ${turn.text}`)
    .join("\n");

  const response = await client.responses.parse({
    model: process.env.OPENAI_MODEL || "gpt-5.6",
    input: [
      { role: "system", content: CLAIM_PROMPT },
      {
        role: "user",
        content: `Known caller details: ${JSON.stringify(defaults)}\n\nCALL TRANSCRIPT:\n${renderedTranscript}`,
      },
    ],
    text: { format: zodTextFormat(claimIntakeSchema, "fnol_claim_intake") },
  });

  if (!response.output_parsed) {
    throw new Error("OpenAI did not return a structured claim");
  }

  const now = new Date();
  const datePart = now.toISOString().slice(2, 10).replaceAll("-", "");
  const suffix = Math.floor(1000 + Math.random() * 9000);

  return {
    ...response.output_parsed,
    claimantName: response.output_parsed.claimantName || defaults.claimantName || "Not provided",
    phone: response.output_parsed.phone || defaults.phone || "Not provided",
    id: `claim-${now.getTime()}`,
    claimNumber: `HH-${datePart}-${suffix}`,
    transcript,
    filedAt: now.toISOString(),
    status: "Needs review",
    taskStatus: process.env.BOX_REVIEWER_USER_ID ? "Assigned" : "Pending",
    coverageStatus: "Needs review",
    coverageRationale: "Pending Box AI policy analysis.",
    policyReferences: [],
    deductible: "Needs review",
    nextSteps: ["Complete policy analysis and route the claim to a human reviewer."],
  };
}

export async function respondToCaller(
  transcript: TranscriptTurn[],
  memoryContext = "",
  signal?: AbortSignal,
): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const input = transcript.map((turn) => ({
    role: turn.role === "caller" ? ("user" as const) : ("assistant" as const),
    content: turn.text,
  }));

  const response = await client.responses.create(
    {
      model: process.env.OPENAI_MODEL || "gpt-5.6",
      instructions: `You are Harbor, a calm property-insurance intake agent speaking on a phone call.
Your job is to create a first notice of loss, not decide coverage.
First confirm everyone is safe. Then gather, one topic at a time: caller name, callback number, property address, date and approximate time of loss, what happened, affected areas, immediate hazards, mitigation already taken, and temporary lodging needs.
Ask only one concise question per turn. Acknowledge distress without sounding scripted. Never use markdown, lists, or emojis because your response is spoken aloud. Do not ask for Social Security, bank, or payment-card information. When the essentials are captured, summarize them briefly and tell the caller they can hang up when ready.
${memoryContext ? `\nUseful customer context:\n${memoryContext}` : ""}`,
      input,
    },
    signal ? { signal } : undefined,
  );

  return response.output_text || "I’m sorry, I didn’t catch that. Could you say that again?";
}
