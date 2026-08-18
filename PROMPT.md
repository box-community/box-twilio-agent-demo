# Build a minimal FNOL voice-claims demo

Build a polished but intentionally small TypeScript demo in which a homeowner calls a Twilio number, speaks with an OpenAI-powered intake agent, and the completed claim is stored and reviewed in Box.

## Architecture

- One Vercel Services project and one public domain, requiring Node 22.13+.
- A Next.js App Router `web` service for the dashboard and API routes.
- A containerized Node/Fastify `voice` service using the current `twilio-agent-connect` TypeScript package. Route all voice traffic under `/voice/*`, including `/voice/twiml`, `/voice/ws`, the completion callback, conversation webhook, and health check.
- Configure the services and same-domain rewrites in `vercel.json`; provide a minimal `Dockerfile.vercel` for the voice process. Use `vercel dev -L` to run both locally.
- OpenAI Responses API for the spoken agent and factual structured claim extraction only.
- Box REST APIs with Client Credentials Grant authentication using `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, and `BOX_ENTERPRISE_ID`. Cache short-lived access tokens server-side and refresh them automatically.
- Box AI `/ai/ask` in `multiple_item_qa` mode for all policy analysis.
- Box is the source of truth; do not add a database or user authentication.

## Call flow

1. Confirm that everyone is safe.
2. Gather one topic per turn: caller name, callback number, property address, loss date/time, what happened, affected areas, hazards, mitigation already taken, and temporary lodging needs.
3. Keep voice responses short and conversational. Never request Social Security, medical, banking, or payment-card data.
4. Retain caller and agent turns for the claim transcript.
5. When the call ends, use OpenAI structured output to extract only reported claim facts. Do not give OpenAI the policy or ask it to assess coverage.

The analysis must be conservative, clearly labeled preliminary, and always routed to human review rather than presented as a binding coverage decision.

## Box record

At server startup, ensure `data/homeowners-policy.md` exists in `BOX_FOLDER_ID`. Upload it when absent and upload a new version when its SHA-1 differs from the local file.

For each completed call with a transcript:

- Upload an intake-only Markdown FNOL report containing reported claim details, summary, affected areas, hazards, notes, and transcript.
- Attach the extracted fields with Box's `global/properties` metadata and mark analysis as pending.
- Call Box `/ai/ask` with the FNOL report and policy file in `multiple_item_qa` mode. Require conservative JSON containing coverage status, rationale, policy references, deductible, next steps, and review notes.
- Parse and validate the Box AI JSON, merge it into the claim, upload the completed Markdown as a new version of the same file, and patch the same values into metadata.
- If Box AI fails, retain the report, mark analysis failed, and use a visible `Needs review` fallback for manual comparison.
- Create a Box `review` task on the report. Assign it when `BOX_REVIEWER_USER_ID` is configured.
- Use `BOX_FOLDER_ID`, defaulting to the CCG Service Account's root folder (`0`).

The dashboard must read claims from that Box folder and link to the source file. Load and parse the report's transcript from Box only when the user opens its Transcript tab. If no Box credentials are configured, show a few realistic sample claims instead. Include a **Run demo call** action that exercises processing; use a bundled transcript when live credentials are unavailable.

## Dashboard

Create one responsive claims-desk screen with:

- a searchable recent-claims queue;
- open/review/priority counts;
- selected-claim overview with loss details, severity, risks, policy assessment, deductible, next steps, Box task status, and notes;
- a transcript tab and an **Open in Box** link.

Keep the visual design restrained and professional. Do not build onboarding, billing, account settings, or other SaaS features.

## Configuration and handoff

Provide `.env.example` and a concise README covering OpenAI, Twilio Agent Connect, one-file local configuration, ngrok, Box CCG authorization, the file read/write and Manage AI scopes, Box AI enablement, and a single Vercel Services deployment. Derive the voice hostname from Vercel's production URL when `TWILIO_VOICE_PUBLIC_DOMAIN` is unset.

Required verification:

- TypeScript check passes.
- Production Next.js build passes.
- Agent Connect starts and registers the namespaced voice routes with placeholder credentials.
- The voice container builds when Docker is available.
- Box CCG token exchange is tested with a mocked response; never expose secrets to client code or logs.
