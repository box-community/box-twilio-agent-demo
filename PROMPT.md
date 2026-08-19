# Minimal first-notice-of-loss (FNOL) voice claims demo

TypeScript web app demo: a homeowner calls a Twilio phone number, talks to an OpenAI intake agent, and the claim is stored and reviewed in Box. Analysis is preliminary and always needs human review. No database or user auth.

## Stack

- Box - CCG app, official `box` NPM module via `box/sdk`, Box AI `/ai/ask` `multiple_item_qa` for all policy analysis
- Twilio - provisioned phone number and Twilio Agent Connect TypeScript SDK
- OpenAI - spoken replies + structured fact extraction only
- Vercel - One Vercel Services project/domain. `vercel.json` services + rewrites; `Dockerfile.vercel`; `vercel dev -L`.
- Next.js - App Router `web` (`/`, `/api/*`). Containerized `twilio-agent-connect` `voice` under `/voice/*` (`/twiml`, `/ws`, completion callback, health).

## Config
`.env.example` with the following: OPENAI_API_KEY, OPENAI_MODEL, BOX_CLIENT_ID, BOX_CLIENT_SECRET, BOX_ENTERPRISE_ID, BOX_FOLDER_ID, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_PHONE_NUMBER, TWILIO_VOICE_PUBLIC_DOMAIN

Never expose secrets to the client or logs.

## Phone Call
Confirm safety. One topic per turn: name, callback, address, loss date/time, what happened, areas, hazards, mitigation, lodging. Short spoken replies. Never ask for SSN, medical, bank, or card data. Keep the transcript. On hangup, extract reported facts only — do not give OpenAI the policy or ask it to assess coverage.

## Box
Startup: ensure a `Loss Reports` child folder exists in `BOX_FOLDER_ID` (default `0`), and sync `data/homeowners-policy.md` to `BOX_FOLDER_ID`; upload or version the policy by SHA-1.
Per completed call: upload the intake Markdown to `Loss Reports` + attach `global/properties` (analysis pending) → Box AI report+policy for conservative JSON (status, rationale, refs, deductible, next steps, notes) → validate, merge, version file, patch metadata. On AI failure keep the report and show **Needs review**. Create a `review` task. Read dashboard claims only from `Loss Reports`.

## Dashboard
One restrained claims-desk screen: searchable queue, counts, overview, transcript tab (load from Box only when opened), Open in Box. Sample claims if Box is unset. **Run demo call** with a bundled transcript when credentials are missing. No SaaS chrome.
