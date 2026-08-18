# Minimal FNOL voice-claims demo

Small TypeScript demo: a homeowner calls Twilio, talks to an OpenAI intake agent, and the claim is stored and reviewed in Box. Analysis is preliminary and always needs human review. No database or user auth. Node 22.13+.

## Stack
One Vercel Services project/domain. Next.js App Router `web` (`/`, `/api/*`). Containerized `twilio-agent-connect` `voice` under `/voice/*` (`/twiml`, `/ws`, completion callback, health). `vercel.json` services + rewrites; `Dockerfile.vercel`; `vercel dev -L`.
OpenAI Responses: spoken replies + structured fact extraction only. Box CCG (`BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_ENTERPRISE_ID`), server-side token cache. Box AI `/ai/ask` `multiple_item_qa` for all policy analysis.

## Call
Confirm safety. One topic per turn: name, callback, address, loss date/time, what happened, areas, hazards, mitigation, lodging. Short spoken replies. Never ask for SSN, medical, bank, or card data. Keep the transcript. On hangup, extract reported facts only — do not give OpenAI the policy or ask it to assess coverage.

## Box
Startup: sync `data/homeowners-policy.md` to `BOX_FOLDER_ID` (default `0`); upload or version by SHA-1.
Per completed call: intake Markdown + `global/properties` (analysis pending) → Box AI report+policy for conservative JSON (status, rationale, refs, deductible, next steps, notes) → validate, merge, version file, patch metadata. On AI failure keep the report and show **Needs review**. Create a `review` task; assign if `BOX_REVIEWER_USER_ID`.

## Dashboard
One restrained claims-desk screen: searchable queue, counts, overview, transcript tab (load from Box only when opened), Open in Box. Sample claims if Box is unset. **Run demo call** with a bundled transcript when credentials are missing. No SaaS chrome.

## Handoff
`.env.example` + concise README (OpenAI, Twilio, `.env.local`, ngrok, Box CCG + file/AI scopes + admin auth, Services deploy). Voice hostname from `VERCEL_PROJECT_PRODUCTION_URL`/`VERCEL_URL` when `TWILIO_VOICE_PUBLIC_DOMAIN` is unset.
Verify: `tsc`, Next production build, voice routes with placeholder creds, Docker image if available, mocked Box CCG token. Never expose secrets to the client or logs.
