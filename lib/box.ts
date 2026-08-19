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
import { Readable } from "node:stream";
import { BoxCcgAuth, BoxClient, CcgConfig } from "box/sdk";

const POLICY_FILE_NAME = "homeowners-policy.md";
const LOSS_REPORTS_FOLDER_NAME = "Loss Reports";
const policyContents = readFileSync(join(process.cwd(), "data", POLICY_FILE_NAME));
const policySha1 = createHash("sha1").update(policyContents).digest("hex");

let cachedBoxClient: BoxClient | undefined;
let pendingBoxStructure: Promise<BoxStructure | undefined> | undefined;

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

function getBoxClient(): BoxClient {
  if (cachedBoxClient) return cachedBoxClient;

  const credentials = requireBoxCredentials();
  const auth = new BoxCcgAuth({
    config: new CcgConfig({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      enterpriseId: credentials.enterpriseId,
    }),
  });
  cachedBoxClient = new BoxClient({ auth });
  return cachedBoxClient;
}

type AnalysisState = {
  analysisStatus: "Pending" | "Complete" | "Failed";
  policyFileId: string;
  analysisCompletedAt?: string;
};

type BoxStructure = {
  policyFileId: string;
  lossReportsFolderId: string;
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

async function uploadTextFile(
  client: BoxClient,
  name: string,
  contents: string | Buffer,
  parentId: string,
): Promise<string> {
  const file = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8");
  const uploaded = await client.uploads.uploadFile({
    attributes: { name, parent: { id: parentId } },
    file: Readable.from([file]),
    fileFileName: name,
    fileContentType: "text/markdown",
  });
  const fileId = uploaded.entries?.[0]?.id;
  if (!fileId) throw new Error(`Box uploaded ${name} without returning a file ID`);
  return fileId;
}

async function uploadTextFileVersion(
  client: BoxClient,
  fileId: string,
  name: string,
  contents: string | Buffer,
): Promise<void> {
  const file = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8");
  await client.uploads.uploadFileVersion(fileId, {
    attributes: { name },
    file: Readable.from([file]),
    fileFileName: name,
    fileContentType: "text/markdown",
  });
}

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

async function analyzeClaimWithBox(
  client: BoxClient,
  claimFileId: string,
  policyFileId: string,
): Promise<ClaimAnalysis> {
  const response = await client.ai.createAiAsk({
    mode: "multiple_item_qa",
    prompt: BOX_AI_PROMPT,
    items: [
      { type: "file", id: claimFileId },
      { type: "file", id: policyFileId },
    ],
    includeCitations: true,
  });
  if (!response?.answer) throw new Error("Box AI returned an empty analysis");
  return parseBoxAiAnalysis(response.answer);
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

export async function getClaimTranscript(fileId: string, client?: BoxClient): Promise<TranscriptTurn[]> {
  if (!/^\d+$/.test(fileId)) throw new Error("Invalid Box file ID");

  const contents = await (client || getBoxClient()).downloads.downloadFile(fileId);
  if (!contents) throw new Error("Box returned an empty claim report");
  const chunks: Buffer[] = [];
  for await (const chunk of contents) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return parseTranscriptFromMarkdown(Buffer.concat(chunks).toString("utf8"));
}

async function listWorkspaceItems(client: BoxClient, workspaceFolderId: string) {
  return client.folders.getFolderItems(workspaceFolderId, {
    queryParams: { limit: 1000, fields: ["id", "type", "name", "sha1"] },
  });
}

function isLossReportsName(name?: string) {
  return name?.toLocaleLowerCase("en-US") === LOSS_REPORTS_FOLDER_NAME.toLocaleLowerCase("en-US");
}

async function ensureLossReportsFolder(
  client: BoxClient,
  workspaceFolderId: string,
  entries: Awaited<ReturnType<typeof listWorkspaceItems>>["entries"],
): Promise<string> {
  const existing = entries?.find((entry) => isLossReportsName(entry.name));
  if (existing?.type === "folder") return existing.id;
  if (existing) {
    throw new Error(`A non-folder item named "${LOSS_REPORTS_FOLDER_NAME}" already exists in BOX_FOLDER_ID`);
  }

  try {
    const folder = await client.folders.createFolder({
      name: LOSS_REPORTS_FOLDER_NAME,
      parent: { id: workspaceFolderId },
    });
    if (!folder.id) throw new Error(`Box created "${LOSS_REPORTS_FOLDER_NAME}" without returning its ID`);
    return folder.id;
  } catch (error) {
    // The web and voice services can start concurrently. If the other service
    // created the folder after our first listing, resolve that race by reusing it.
    const refreshed = await listWorkspaceItems(client, workspaceFolderId);
    const folder = refreshed.entries?.find(
      (entry) => entry.type === "folder" && isLossReportsName(entry.name),
    );
    if (folder) return folder.id;
    throw error;
  }
}

async function syncBoxStructure(client: BoxClient): Promise<BoxStructure> {
  const workspaceFolderId = process.env.BOX_FOLDER_ID || "0";
  const items = await listWorkspaceItems(client, workspaceFolderId);
  const lossReportsFolderId = await ensureLossReportsFolder(client, workspaceFolderId, items.entries);
  const existingPolicy = items.entries?.find(
    (entry) => entry.type === "file" && entry.name === POLICY_FILE_NAME,
  );

  let policyFileId: string;
  if (!existingPolicy || existingPolicy.type !== "file") {
    policyFileId = await uploadTextFile(client, POLICY_FILE_NAME, policyContents, workspaceFolderId);
  } else {
    if (existingPolicy.sha1?.toLowerCase() !== policySha1) {
      await uploadTextFileVersion(client, existingPolicy.id, POLICY_FILE_NAME, policyContents);
    }
    policyFileId = existingPolicy.id;
  }

  return { policyFileId, lossReportsFolderId };
}

export async function ensureBoxStructureInBox(client?: BoxClient): Promise<BoxStructure | undefined> {
  if (!client && !hasAnyBoxCredentials()) return undefined;
  if (!pendingBoxStructure) {
    pendingBoxStructure = syncBoxStructure(client || getBoxClient()).catch((error) => {
      pendingBoxStructure = undefined;
      throw error;
    });
  }
  return pendingBoxStructure;
}

export async function saveClaimToBox(claim: Claim, client?: BoxClient): Promise<Claim> {
  if (!client && !hasAnyBoxCredentials()) return claim;

  const box = client || getBoxClient();
  const structure = await ensureBoxStructureInBox(box);
  if (!structure) throw new Error("The Box workspace could not be initialized");
  const { policyFileId, lossReportsFolderId } = structure;

  const claimForBox: Claim = {
    ...claim,
    taskStatus: process.env.BOX_REVIEWER_USER_ID ? "Assigned" : "Pending",
  };
  const fileName = `${claim.claimNumber}.md`;
  const fileId = await uploadTextFile(
    box,
    fileName,
    claimIntakeToMarkdown(claimForBox),
    lossReportsFolderId,
  );

  await box.fileMetadata.createFileMetadataById(
    fileId,
    "global",
    "properties",
    metadataFor(claimForBox, { analysisStatus: "Pending", policyFileId }),
  );

  let analyzedClaim: Claim;
  let analysisStatus: AnalysisState["analysisStatus"];
  try {
    const analysis = await analyzeClaimWithBox(box, fileId, policyFileId);
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

  await uploadTextFileVersion(box, fileId, fileName, claimToMarkdown(analyzedClaim));
  await box.fileMetadata.updateFileMetadataById(
    fileId,
    "global",
    "properties",
    metadataPatch(
      metadataFor(analyzedClaim, {
        analysisStatus,
        policyFileId,
        analysisCompletedAt: new Date().toISOString(),
      }),
    ),
  );

  const task = await box.tasks.createTask({
    item: { id: fileId, type: "file" },
    action: "review",
    message: `Review FNOL ${claim.claimNumber} and confirm the preliminary Box AI policy assessment.`,
    completionRule: "all_assignees",
  });

  if (process.env.BOX_REVIEWER_USER_ID) {
    if (!task.id) throw new Error("Box created a review task without returning its ID");
    await box.taskAssignments.createTaskAssignment({
      task: { id: task.id, type: "task" },
      assignTo: { id: process.env.BOX_REVIEWER_USER_ID },
    });
  }

  return {
    ...analyzedClaim,
    boxFileId: fileId,
    boxUrl: `https://app.box.com/file/${fileId}`,
    taskStatus: process.env.BOX_REVIEWER_USER_ID ? "Assigned" : "Pending",
  };
}

export async function listClaims(client?: BoxClient): Promise<Claim[]> {
  if (!client && !hasAnyBoxCredentials()) return demoClaims;

  const box = client || getBoxClient();
  const structure = await ensureBoxStructureInBox(box);
  if (!structure) return demoClaims;
  const items = await box.folders.getFolderItems(structure.lossReportsFolderId, {
    queryParams: {
      limit: 100,
      fields: ["id", "type", "name", "created_at", "metadata.global.properties"],
    },
  });

  const claims = (items.entries || [])
    .filter((entry) => entry.type === "file" && entry.name?.endsWith(".md"))
    .map((entry) => {
      if (entry.type !== "file") return null;
      const values = entry.metadata?.extraData?.global?.properties?.extraData;
      const metadata = values
        ? Object.fromEntries(
            Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          )
        : undefined;
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
        filedAt: metadata.filedAt || entry.createdAt?.value.toISOString() || new Date().toISOString(),
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
