import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { newDemoClaim } from "@/lib/mock-data";
import {
  BoxCcgAuth,
  BoxClient,
  CcgConfig,
} from "box/sdk";
import { NetworkSession, type FetchOptionsInput, type NetworkClient } from "box/sdk/networking";

test("BoxCcgAuth exchanges and caches CCG credentials through the SDK", async () => {
  const requests: FetchOptionsInput[] = [];
  const networkClient: NetworkClient = {
    async fetch(request) {
      requests.push(request);
      return {
        status: 200,
        headers: {},
        data: {
          access_token: "test-token",
          expires_in: 3600,
          token_type: "bearer",
          restricted_to: [],
        },
      };
    },
  };
  const session = new NetworkSession({ networkClient });
  const auth = new BoxCcgAuth({
    config: new CcgConfig({
      clientId: "test-client",
      clientSecret: "test-secret",
      enterpriseId: "test-enterprise",
    }),
  });

  assert.equal(await auth.retrieveAuthorizationHeader(session), "Bearer test-token");
  assert.equal(await auth.retrieveAuthorizationHeader(session), "Bearer test-token");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.box.com/oauth2/token");
  const tokenBody = requests[0]?.data as Record<string, unknown>;
  assert.equal(tokenBody.grant_type, "client_credentials");
  assert.equal(tokenBody.client_id, "test-client");
  assert.equal(tokenBody.client_secret, "test-secret");
  assert.equal(tokenBody.box_subject_type, "enterprise");
  assert.equal(tokenBody.box_subject_id, "test-enterprise");
});

test("persists intake, asks Box AI, and writes the completed claim with SDK managers", async () => {
  const originalFolderId = process.env.BOX_FOLDER_ID;
  const originalReviewerId = process.env.BOX_REVIEWER_USER_ID;
  process.env.BOX_FOLDER_ID = "42";
  delete process.env.BOX_REVIEWER_USER_ID;

  const calls = {
    folderQueries: [] as unknown[],
    uploads: [] as Array<{ attributes: { name: string } }>,
    versions: [] as Array<{ fileId: string; attributes: { name: string } }>,
    metadataCreates: [] as Array<Record<string, string>>,
    metadataUpdates: [] as Array<Array<{ path?: string; value?: unknown }>>,
    ai: [] as Array<{ mode: string; items: readonly { id: string }[]; includeCitations?: boolean }>,
    tasks: [] as unknown[],
  };

  const fakeClient = {
    folders: {
      async getFolderItems(_folderId: string, options: unknown) {
        calls.folderQueries.push(options);
        if (calls.folderQueries.length === 1) return { entries: [] };

        const metadata = { ...calls.metadataCreates[0] };
        for (const operation of calls.metadataUpdates[0] || []) {
          if (operation.path?.startsWith("/") && typeof operation.value === "string") {
            metadata[operation.path.slice(1)] = operation.value;
          }
        }
        return {
          entries: [
            {
              id: "200",
              type: "file",
              name: `${metadata.claimNumber}.md`,
              createdAt: { value: new Date("2026-08-18T12:00:00Z") },
              metadata: { extraData: { global: { properties: { extraData: metadata } } } },
            },
          ],
        };
      },
    },
    uploads: {
      async uploadFile(body: { attributes: { name: string } }) {
        calls.uploads.push(body);
        return { entries: [{ id: body.attributes.name === "homeowners-policy.md" ? "100" : "200" }] };
      },
      async uploadFileVersion(fileId: string, body: { attributes: { name: string } }) {
        calls.versions.push({ fileId, ...body });
        return { entries: [] };
      },
    },
    fileMetadata: {
      async createFileMetadataById(
        _fileId: string,
        _scope: string,
        _template: string,
        metadata: Record<string, string>,
      ) {
        calls.metadataCreates.push(metadata);
        return {};
      },
      async updateFileMetadataById(
        _fileId: string,
        _scope: string,
        _template: string,
        patch: Array<{ path?: string; value?: unknown }>,
      ) {
        calls.metadataUpdates.push(patch);
        return {};
      },
    },
    ai: {
      async createAiAsk(body: (typeof calls.ai)[number]) {
        calls.ai.push(body);
        return {
          answer: JSON.stringify({
            coverageStatus: "Likely covered",
            coverageRationale: "The reported loss is a sudden plumbing discharge.",
            policyReferences: ["Dwelling and other structures", "Deductibles"],
            deductible: "$1,500 all-peril deductible",
            nextSteps: ["Retain mitigation and repair records.", "Have an adjuster confirm coverage."],
            notes: ["Repair of the failed plumbing component is not covered."],
          }),
        };
      },
    },
    tasks: {
      async createTask(body: unknown) {
        calls.tasks.push(body);
        return { id: "300" };
      },
    },
    taskAssignments: {
      async createTaskAssignment() {
        return {};
      },
    },
    downloads: {
      async downloadFile() {
        return Readable.from([
          Buffer.from("## Call transcript\n\n**Caller:** Water is entering the kitchen.\n\n**Harbor:** Is everyone safe?"),
        ]);
      },
    },
  } as unknown as BoxClient;

  try {
    const { getClaimTranscript, listClaims, saveClaimToBox } = await import("@/lib/box");
    const saved = await saveClaimToBox(newDemoClaim(), fakeClient);

    assert.equal(saved.boxFileId, "200");
    assert.equal(saved.coverageStatus, "Likely covered");
    assert.deepEqual(saved.policyReferences, ["Dwelling and other structures", "Deductibles"]);
    assert.ok(saved.notes.includes("Repair of the failed plumbing component is not covered."));

    assert.deepEqual(
      calls.uploads.map((upload) => upload.attributes.name),
      ["homeowners-policy.md", `${saved.claimNumber}.md`],
    );
    assert.deepEqual(calls.ai[0]?.items.map((item) => item.id), ["200", "100"]);
    assert.equal(calls.ai[0]?.mode, "multiple_item_qa");
    assert.equal(calls.ai[0]?.includeCitations, true);
    assert.equal(calls.versions[0]?.fileId, "200");
    assert.equal(calls.metadataCreates[0]?.analysisStatus, "Pending");

    const patch = calls.metadataUpdates[0] || [];
    assert.equal(patch.find((operation) => operation.path === "/analysisStatus")?.value, "Complete");
    assert.equal(patch.find((operation) => operation.path === "/coverageStatus")?.value, "Likely covered");

    const listed = await listClaims(fakeClient);
    assert.equal(listed[0]?.claimNumber, saved.claimNumber);
    assert.equal(listed[0]?.coverageStatus, "Likely covered");
    assert.deepEqual(await getClaimTranscript("200", fakeClient), [
      { role: "caller", text: "Water is entering the kitchen." },
      { role: "agent", text: "Is everyone safe?" },
    ]);
  } finally {
    if (originalFolderId === undefined) delete process.env.BOX_FOLDER_ID;
    else process.env.BOX_FOLDER_ID = originalFolderId;
    if (originalReviewerId === undefined) delete process.env.BOX_REVIEWER_USER_ID;
    else process.env.BOX_REVIEWER_USER_ID = originalReviewerId;
  }
});
