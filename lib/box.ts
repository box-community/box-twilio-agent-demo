import { demoClaims } from "@/lib/mock-data";
import { claimIntakeToMarkdown, claimToMarkdown } from "@/lib/report";
import {
  claimAnalysisSchema,
  claimSchema,
  type Claim,
  type ClaimAnalysis,
  type TranscriptTurn,
} from "@/lib/types";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BOX_API = "https://api.box.com/2.0";
const BOX_UPLOAD_API = "https://upload.box.com/api/2.0";
const BOX_TOKEN_URL = "https://api.box.com/oauth2/token";
const POLICY_FILE_NAME = "homeowners-policy.md";
const policyContents = readFileSync(join(process.cwd(), "data", POLICY_FILE_NAME));
const policySha1 = createHash("sha1").update(policyContents).digest("hex");

type CachedBoxToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedBoxToken: CachedBoxToken | undefined;
let pendingBoxToken: Promise<string> | undefined;
let pendingPolicyFile: Promise<string | undefined> | undefined;

const boxCredentialNames = ["BOX_CLIENT_ID", "BOX_CLIENT_SECRET", "BOX_ENTERPRISE_ID"] as const;

function hasAnyBoxCredentials() {
  return (
    boxCredentialNames.some((name) => Boolean(process.env[name]?.trim())) ||
    Boolean(process.env.BOX_ACCESS_TOKEN?.trim())
  );
}

export function isBoxConfigured() {
  return boxCredentialNames.every((name) => Boolean(process.env[name]?.trim()));
}

function requireBoxCredentials() {
  const missing = boxCredentialNames.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    if (process.env.BOX_ACCESS_TOKEN?.trim() && missing.length === boxCredentialNames.length) {
      throw new Error(
        "BOX_ACCESS_TOKEN is no longer supported. Configure BOX_CLIENT_ID, BOX_CLIENT_SECRET, and BOX_ENTERPRISE_ID for Box CCG authentication.",
      );
    }
    throw new Error(`Box CCG configuration is incomplete. Missing: ${missing.join(", ")}`);
  }

  return {
    clientId: process.env.BOX_CLIENT_ID!,
    clientSecret: process.env.BOX_CLIENT_SECRET!,
    enterpriseId: process.env.BOX_ENTERPRISE_ID!,
  };
}

async function requestBoxAccessToken(): Promise<string> {
  const credentials = requireBoxCredentials();
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    box_subject_type: "enterprise",
    box_subject_id: credentials.enterpriseId,
  });

  const response = await fetch(BOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Box CCG authentication failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  const token = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!token.access_token) {
    throw new Error("Box CCG authentication succeeded without an access token");
  }

  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : 3600;
  cachedBoxToken = {
    accessToken: token.access_token,
    // Refresh at least one minute before Box says the token expires.
    expiresAt: Date.now() + Math.max(expiresIn - 60, 30) * 1000,
  };

  return token.access_token;
}

async function getBoxAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedBoxToken && cachedBoxToken.expiresAt > Date.now()) {
    return cachedBoxToken.accessToken;
  }

  if (!forceRefresh && pendingBoxToken) return pendingBoxToken;

  cachedBoxToken = undefined;
  pendingBoxToken = requestBoxAccessToken();

  try {
    return await pendingBoxToken;
  } finally {
    pendingBoxToken = undefined;
  }
}

async function boxFetch(url: string, init: RequestInit = {}, retryUnauthorized = true): Promise<Response> {
  const accessToken = await getBoxAccessToken(!retryUnauthorized);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });

  if (response.status === 401 && retryUnauthorized) {
    cachedBoxToken = undefined;
    return boxFetch(url, init, false);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Box API ${response.status}: ${detail.slice(0, 500)}`);
  }

  return response;
}

type AnalysisState = {
  analysisStatus: "Pending" | "Complete" | "Failed";
  policyFileId: string;
  analysisCompletedAt?: string;
};

function metadataFor(claim: Claim, analysis: AnalysisState): Record<string, string> {
  return {
    claimNumber: claim.claimNumber,
    claimantName: claim.claimantName,
    phone: claim.phone,
    propertyAddress: claim.propertyAddress,
    lossDate: claim.lossDate,
    lossType: claim.lossType,
    severity: claim.severity,
    coverageStatus: claim.coverageStatus,
    status: claim.status,
    taskStatus: claim.taskStatus,
    filedAt: claim.filedAt,
    summary: claim.summary.slice(0, 1000),
    coverageRationale: claim.coverageRationale.slice(0, 1000),
    deductible: claim.deductible,
    damageAreas: JSON.stringify(claim.damageAreas).slice(0, 1000),
    immediateRisks: JSON.stringify(claim.immediateRisks).slice(0, 1000),
    policyReferences: JSON.stringify(claim.policyReferences).slice(0, 1000),
    nextSteps: JSON.stringify(claim.nextSteps).slice(0, 1000),
    notes: JSON.stringify(claim.notes).slice(0, 1000),
    analysisProvider: "Box AI",
    analysisStatus: analysis.analysisStatus,
    policyFileId: analysis.policyFileId,
    ...(analysis.analysisCompletedAt ? { analysisCompletedAt: analysis.analysisCompletedAt } : {}),
  };
}

async function uploadTextFile(name: string, contents: BlobPart, parentId: string): Promise<string> {
  const form = new FormData();
  form.append("attributes", JSON.stringify({ name, parent: { id: parentId } }));
  form.append("file", new Blob([contents], { type: "text/markdown" }), name);

  const response = await boxFetch(`${BOX_UPLOAD_API}/files/content`, { method: "POST", body: form });
  const body = (await response.json()) as { entries?: Array<{ id: string }> };
  const fileId = body.entries?.[0]?.id;
  if (!fileId) throw new Error(`Box uploaded ${name} without returning a file ID`);
  return fileId;
}

async function uploadTextFileVersion(fileId: string, name: string, contents: BlobPart): Promise<void> {
  const form = new FormData();
  form.append("attributes", JSON.stringify({ name }));
  form.append("file", new Blob([contents], { type: "text/markdown" }), name);
  await boxFetch(`${BOX_UPLOAD_API}/files/${fileId}/content`, { method: "POST", body: form });
}

type BoxAiAskResponse = {
  answer?: string;
};

const BOX_AI_PROMPT = `Compare the first-notice-of-loss report with the homeowners policy and return only one valid JSON object. Do not use Markdown fences.

Required shape:
{
  "coverageStatus": "Likely covered" | "Partially covered" | "Needs review" | "Likely excluded",
  "coverageRationale": "concise preliminary rationale",
  "policyReferences": ["specific policy section or heading"],
  "deductible": "applicable deductible or Needs review",
  "nextSteps": ["prioritized safety, mitigation, documentation, or review action"],
  "notes": ["short ambiguity or human-review note"]
}

Treat the claim report as reported facts and the policy file as the only source of policy terms. Never invent missing facts or policy language. Choose "Needs review" when facts are insufficient. This is preliminary triage, not a binding coverage decision, and the result must be reviewed by a human adjuster.`;

export function parseBoxAiAnalysis(answer: string): ClaimAnalysis {
  const trimmed = answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("Box AI did not return a JSON analysis");
  return claimAnalysisSchema.parse(JSON.parse(trimmed.slice(start, end + 1)));
}

async function analyzeClaimWithBox(claimFileId: string, policyFileId: string): Promise<ClaimAnalysis> {
  const response = await boxFetch(`${BOX_API}/ai/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "multiple_item_qa",
      prompt: BOX_AI_PROMPT,
      items: [
        { type: "file", id: claimFileId },
        { type: "file", id: policyFileId },
      ],
      include_citations: true,
    }),
  });
  const body = (await response.json()) as BoxAiAskResponse;
  if (!body.answer) throw new Error("Box AI returned an empty analysis");
  return parseBoxAiAnalysis(body.answer);
}

function metadataPatch(metadata: Record<string, string>) {
  return Object.entries(metadata).map(([key, value]) => ({
    op: "add",
    path: `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
    value,
  }));
}

function parseArray(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseTranscriptFromMarkdown(markdown: string): TranscriptTurn[] {
  const heading = /^## Call transcript\s*$/m.exec(markdown);
  if (!heading || heading.index === undefined) return [];

  const afterHeading = markdown.slice(heading.index + heading[0].length);
  const nextHeadingIndex = afterHeading.search(/^##\s/m);
  const section = nextHeadingIndex === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIndex);
  const speakerPattern = /^\*\*(Caller|Harbor):\*\*\s*/gm;
  const speakers = [...section.matchAll(speakerPattern)];

  return speakers
    .map((speaker, index): TranscriptTurn | null => {
      const start = (speaker.index ?? 0) + speaker[0].length;
      const end = speakers[index + 1]?.index ?? section.length;
      const text = section.slice(start, end).trim();
      if (!text) return null;

      return {
        role: speaker[1] === "Caller" ? "caller" : "agent",
        text,
      };
    })
    .filter((turn): turn is TranscriptTurn => turn !== null);
}

export async function getClaimTranscript(fileId: string): Promise<TranscriptTurn[]> {
  if (!/^\d+$/.test(fileId)) throw new Error("Invalid Box file ID");

  const response = await boxFetch(`${BOX_API}/files/${encodeURIComponent(fileId)}/content`);
  return parseTranscriptFromMarkdown(await response.text());
}

async function syncPolicyToBox(): Promise<string> {
  const folderId = process.env.BOX_FOLDER_ID || "0";
  const fields = encodeURIComponent("id,type,name,sha1");
  const response = await boxFetch(`${BOX_API}/folders/${folderId}/items?limit=1000&fields=${fields}`);
  const body = (await response.json()) as {
    entries?: Array<{ id: string; type: string; name: string; sha1?: string }>;
  };
  const existing = body.entries?.find((entry) => entry.type === "file" && entry.name === POLICY_FILE_NAME);

  if (!existing) return uploadTextFile(POLICY_FILE_NAME, policyContents, folderId);

  if (existing.sha1?.toLowerCase() !== policySha1) {
    await uploadTextFileVersion(existing.id, POLICY_FILE_NAME, policyContents);
  }

  return existing.id;
}

export async function ensurePolicyInBox(): Promise<string | undefined> {
  if (!hasAnyBoxCredentials()) return undefined;
  if (!pendingPolicyFile) {
    pendingPolicyFile = syncPolicyToBox().catch((error) => {
      pendingPolicyFile = undefined;
      throw error;
    });
  }
  return pendingPolicyFile;
}

export async function saveClaimToBox(claim: Claim): Promise<Claim> {
  if (!hasAnyBoxCredentials()) return claim;

  const policyFileId = await ensurePolicyInBox();
  if (!policyFileId) throw new Error("The policy could not be synchronized to Box");

  const claimForBox: Claim = {
    ...claim,
    taskStatus: process.env.BOX_REVIEWER_USER_ID ? "Assigned" : "Pending",
  };
  const fileName = `${claim.claimNumber}.md`;
  const fileId = await uploadTextFile(
    fileName,
    claimIntakeToMarkdown(claimForBox),
    process.env.BOX_FOLDER_ID || "0",
  );

  await boxFetch(`${BOX_API}/files/${fileId}/metadata/global/properties`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadataFor(claimForBox, { analysisStatus: "Pending", policyFileId })),
  });

  let analyzedClaim: Claim;
  let analysisStatus: AnalysisState["analysisStatus"];
  try {
    const analysis = await analyzeClaimWithBox(fileId, policyFileId);
    analyzedClaim = {
      ...claimForBox,
      ...analysis,
      notes: [...new Set([...claimForBox.notes, ...analysis.notes])],
    };
    analysisStatus = "Complete";
  } catch (error) {
    console.error(`Box AI analysis failed for ${claim.claimNumber}:`, error);
    analyzedClaim = {
      ...claimForBox,
      coverageStatus: "Needs review",
      coverageRationale:
        "Box AI policy analysis was unavailable. A human adjuster must compare this claim with the policy.",
      policyReferences: [],
      deductible: "Needs review",
      nextSteps: ["Review the claim and homeowners policy manually before making a coverage decision."],
      notes: [...new Set([...claimForBox.notes, "Automated policy analysis did not complete."])],
    };
    analysisStatus = "Failed";
  }

  await uploadTextFileVersion(fileId, fileName, claimToMarkdown(analyzedClaim));
  await boxFetch(`${BOX_API}/files/${fileId}/metadata/global/properties`, {
    method: "PUT",
    headers: { "Content-Type": "application/json-patch+json" },
    body: JSON.stringify(
      metadataPatch(
        metadataFor(analyzedClaim, {
          analysisStatus,
          policyFileId,
          analysisCompletedAt: new Date().toISOString(),
        }),
      ),
    ),
  });

  const taskResponse = await boxFetch(`${BOX_API}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      item: { id: fileId, type: "file" },
      action: "review",
      message: `Review FNOL ${claim.claimNumber} and confirm the preliminary Box AI policy assessment.`,
      completion_rule: "all_assignees",
    }),
  });
  const task = (await taskResponse.json()) as { id: string };

  if (process.env.BOX_REVIEWER_USER_ID) {
    await boxFetch(`${BOX_API}/task_assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: { id: task.id, type: "task" },
        assign_to: { id: process.env.BOX_REVIEWER_USER_ID },
      }),
    });
  }

  return {
    ...analyzedClaim,
    boxFileId: fileId,
    boxUrl: `https://app.box.com/file/${fileId}`,
    taskStatus: process.env.BOX_REVIEWER_USER_ID ? "Assigned" : "Pending",
  };
}

type BoxEntry = {
  id: string;
  type: string;
  name: string;
  created_at?: string;
  metadata?: { global?: { properties?: Record<string, string> } };
};

export async function listClaims(): Promise<Claim[]> {
  if (!hasAnyBoxCredentials()) return demoClaims;

  await ensurePolicyInBox();

  const folderId = process.env.BOX_FOLDER_ID || "0";
  const fields = encodeURIComponent("id,type,name,created_at,metadata.global.properties");
  const response = await boxFetch(`${BOX_API}/folders/${folderId}/items?limit=100&fields=${fields}`);
  const body = (await response.json()) as { entries?: BoxEntry[] };

  const claims = (body.entries || [])
    .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
    .map((entry) => {
      const metadata = entry.metadata?.global?.properties;
      if (!metadata?.claimNumber) return null;

      const candidate = {
        id: entry.id,
        claimNumber: metadata.claimNumber,
        claimantName: metadata.claimantName || "Not provided",
        phone: metadata.phone || "Not provided",
        propertyAddress: metadata.propertyAddress || "Not provided",
        lossDate: metadata.lossDate || "Not provided",
        lossType: metadata.lossType || "Other",
        summary: metadata.summary || "Open the Box report for details.",
        damageAreas: parseArray(metadata.damageAreas),
        immediateRisks: parseArray(metadata.immediateRisks),
        severity: metadata.severity || "Moderate",
        coverageStatus: metadata.coverageStatus || "Needs review",
        coverageRationale: metadata.coverageRationale || "Pending human review.",
        policyReferences: parseArray(metadata.policyReferences),
        deductible: metadata.deductible || "Needs review",
        nextSteps: parseArray(metadata.nextSteps),
        notes: parseArray(metadata.notes),
        transcript: [],
        filedAt: metadata.filedAt || entry.created_at || new Date().toISOString(),
        status: metadata.status || "Needs review",
        taskStatus: metadata.taskStatus || "Pending",
        boxFileId: entry.id,
        boxUrl: `https://app.box.com/file/${entry.id}`,
      };

      const parsed = claimSchema.safeParse(candidate);
      return parsed.success ? parsed.data : null;
    })
    .filter((claim): claim is Claim => claim !== null)
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt));

  return claims;
}
