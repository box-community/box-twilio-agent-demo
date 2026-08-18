import assert from "node:assert/strict";
import test from "node:test";
import { newDemoClaim } from "@/lib/mock-data";

test("persists intake, asks Box AI, and writes the completed claim", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    BOX_CLIENT_ID: process.env.BOX_CLIENT_ID,
    BOX_CLIENT_SECRET: process.env.BOX_CLIENT_SECRET,
    BOX_ENTERPRISE_ID: process.env.BOX_ENTERPRISE_ID,
    BOX_FOLDER_ID: process.env.BOX_FOLDER_ID,
    BOX_REVIEWER_USER_ID: process.env.BOX_REVIEWER_USER_ID,
  };
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  process.env.BOX_CLIENT_ID = "test-client";
  process.env.BOX_CLIENT_SECRET = "test-secret";
  process.env.BOX_ENTERPRISE_ID = "test-enterprise";
  process.env.BOX_FOLDER_ID = "42";
  delete process.env.BOX_REVIEWER_USER_ID;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });

    if (url === "https://api.box.com/oauth2/token") {
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    }
    if (url.includes("/folders/42/items")) return Response.json({ entries: [] });
    if (url === "https://upload.box.com/api/2.0/files/content") {
      const attributes = JSON.parse(String((init?.body as FormData).get("attributes"))) as { name: string };
      return Response.json({ entries: [{ id: attributes.name === "homeowners-policy.md" ? "100" : "200" }] });
    }
    if (url.endsWith("/files/200/metadata/global/properties") && init?.method === "POST") {
      return Response.json({});
    }
    if (url.endsWith("/ai/ask")) {
      return Response.json({
        answer: JSON.stringify({
          coverageStatus: "Likely covered",
          coverageRationale: "The reported loss is a sudden plumbing discharge.",
          policyReferences: ["Dwelling and other structures", "Deductibles"],
          deductible: "$1,500 all-peril deductible",
          nextSteps: ["Retain mitigation and repair records.", "Have an adjuster confirm coverage."],
          notes: ["Repair of the failed plumbing component is not covered."],
        }),
      });
    }
    if (url === "https://upload.box.com/api/2.0/files/200/content") return Response.json({ entries: [] });
    if (url.endsWith("/files/200/metadata/global/properties") && init?.method === "PUT") {
      return Response.json({});
    }
    if (url.endsWith("/tasks")) return Response.json({ id: "300" });

    return new Response(`Unexpected request: ${url}`, { status: 500 });
  }) as typeof fetch;

  try {
    const { saveClaimToBox } = await import("@/lib/box");
    const claim = newDemoClaim();
    const saved = await saveClaimToBox(claim);

    assert.equal(saved.boxFileId, "200");
    assert.equal(saved.coverageStatus, "Likely covered");
    assert.deepEqual(saved.policyReferences, ["Dwelling and other structures", "Deductibles"]);
    assert.ok(saved.notes.includes("Repair of the failed plumbing component is not covered."));

    const ask = calls.find((call) => call.url.endsWith("/ai/ask"));
    const askBody = JSON.parse(String(ask?.init?.body)) as {
      mode: string;
      items: Array<{ id: string }>;
    };
    assert.equal(askBody.mode, "multiple_item_qa");
    assert.deepEqual(
      askBody.items.map((item) => item.id),
      ["200", "100"],
    );

    const metadataUpdate = calls.find(
      (call) => call.url.endsWith("/files/200/metadata/global/properties") && call.init?.method === "PUT",
    );
    const patch = JSON.parse(String(metadataUpdate?.init?.body)) as Array<{ path: string; value: string }>;
    assert.equal(patch.find((operation) => operation.path === "/analysisStatus")?.value, "Complete");
    assert.equal(patch.find((operation) => operation.path === "/coverageStatus")?.value, "Likely covered");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
