import { demoClaims } from "@/lib/mock-data";
import { claimSchema, type Claim, type TranscriptTurn } from "@/lib/types";
import { claimToMarkdown } from "@/lib/report";

const BOX_API = "https://api.box.com/2.0";
const BOX_UPLOAD_API = "https://upload.box.com/api/2.0";
const BOX_TOKEN_URL = "https://api.box.com/oauth2/token";

type CachedBoxToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedBoxToken: CachedBoxToken | undefined;
let pendingBoxToken: Promise<string> | undefined;

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

function metadataFor(claim: Claim): Record<string, string> {
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
  };
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

export async function saveClaimToBox(claim: Claim): Promise<Claim> {
  if (!hasAnyBoxCredentials()) return claim;

  const markdown = claimToMarkdown(claim);
  const form = new FormData();
  form.append(
    "attributes",
    JSON.stringify({ name: `${claim.claimNumber}.md`, parent: { id: process.env.BOX_FOLDER_ID || "0" } }),
  );
  form.append("file", new Blob([markdown], { type: "text/markdown" }), `${claim.claimNumber}.md`);

  const upload = await boxFetch(`${BOX_UPLOAD_API}/files/content`, { method: "POST", body: form });
  const uploadBody = (await upload.json()) as { entries?: Array<{ id: string }> };
  const fileId = uploadBody.entries?.[0]?.id;
  if (!fileId) throw new Error("Box upload succeeded without a file ID");

  await boxFetch(`${BOX_API}/files/${fileId}/metadata/global/properties`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadataFor(claim)),
  });

  const taskResponse = await boxFetch(`${BOX_API}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      item: { id: fileId, type: "file" },
      action: "review",
      message: `Review FNOL ${claim.claimNumber} and confirm the preliminary coverage assessment.`,
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
    ...claim,
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
