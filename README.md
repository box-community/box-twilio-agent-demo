# Harbor FNOL demo

A deliberately small first-notice-of-loss demo built around a phone call. Twilio Agent Connect handles the voice channel, OpenAI conducts and structures the intake, and Box becomes the claim record: a readable Markdown report, searchable metadata, and a review task.

The web app is a lightweight claim desk, not a second system of record. With Box credentials configured it reads claims directly from a Box folder; without credentials it starts in a polished demo mode.

## What it does

1. A homeowner calls the Twilio number.
2. The Harbor voice agent confirms safety and gathers one claim field at a time.
3. When the call ends, OpenAI extracts the FNOL and performs a preliminary comparison against the sample policy.
4. The app uploads a Markdown report to Box, attaches claim fields through Box global-properties metadata, and creates a `review` task.
5. The dashboard displays the resulting claims and links back to the source file in Box.

Coverage language in the demo is intentionally labeled preliminary and always routes to human review.

## Run it

This project requires Node 22.13 or later, matching Twilio Agent Connect's current TypeScript requirement.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click **Run demo call** to exercise the processing state. With no credentials, it uses the included sample claim. With OpenAI and Box configured, it performs structured extraction and writes the result to Box.

## Connect Box

Create a Box **Platform App** and select **Client Credentials Grant** as its authentication method. In the app's Configuration tab, enable the scopes needed to read/write files, manage metadata, and manage tasks, then have a Box Admin or Co-Admin authorize the app.

Add the credentials from the Box Developer Console to `.env.local` and `.env`:

```env
BOX_CLIENT_ID=your_client_id
BOX_CLIENT_SECRET=your_client_secret
BOX_ENTERPRISE_ID=your_enterprise_id
BOX_FOLDER_ID=0
```

The server exchanges these credentials for a short-lived Service Account access token and refreshes it automatically. Keep `BOX_CLIENT_SECRET` server-side and out of source control. `BOX_FOLDER_ID=0` uses the Service Account's root folder; for another folder, make sure the Service Account can access it and set that folder's ID. The app uses Box's built-in `global/properties` metadata template, so a custom enterprise metadata template is not required for this demo.

Optionally set `BOX_REVIEWER_USER_ID`. When present, the review task is assigned to that Box user; otherwise the task is created but left unassigned.

If Box returns `unauthorized_client`, confirm that an Admin has authorized the application. If it returns `invalid_grant`, verify that the client ID and secret belong to the same CCG app and that `BOX_ENTERPRISE_ID` is the enterprise that authorized it. Changes to scopes or application access require Admin reauthorization.

## Connect the phone number

Copy `.env.example` to `.env` as well, fill in the Twilio and OpenAI values, and expose port 8080 with a public HTTPS/WebSocket tunnel:

```bash
npm run voice:dev
ngrok http 8080
```

Set `TWILIO_VOICE_PUBLIC_DOMAIN` to the tunnel hostname only, for example `example.ngrok.app`. In the Twilio phone-number configuration set the incoming-call webhook to:

```text
POST https://example.ngrok.app/twiml
```

Health check: `GET /health`. Agent Connect serves its ConversationRelay WebSocket at `/ws` and the call-completion callback at `/conversation-relay-callback`.

The Next.js dashboard and Box-reading API are ready for Vercel. For the simplest, most predictable demo setup, run the Agent Connect voice process locally behind a tunnel (as in Twilio's quickstart) or on a small container host. Vercel added native WebSocket support in public beta in June 2026, but this standalone Fastify voice entry point is intentionally kept out of that beta-specific deployment path.

## Environment

See [.env.example](./.env.example) for the full list. The important values are:

- `OPENAI_API_KEY` and optional `OPENAI_MODEL` (defaults to `gpt-5.6`)
- `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_ENTERPRISE_ID`, `BOX_FOLDER_ID`, and optional `BOX_REVIEWER_USER_ID`
- Twilio account/API credentials, phone number, Conversation Configuration ID, and public voice hostname

## Project map

- `src/voice/server.ts` — Twilio Agent Connect voice lifecycle
- `lib/openai.ts` — caller responses and structured FNOL analysis
- `lib/box.ts` — report upload, metadata, review task, and claim listing
- `lib/report.ts` — human-readable Markdown report
- `data/homeowners-policy.md` — explicit demo policy used for preliminary analysis
- `app/` and `components/` — Vercel-hosted claim desk

## Notes for a real deployment

This is a demo, not a production claims system. Before using real policyholder data, add durable job retries, managed secret storage, webhook signature validation tests, access control, retention rules, observability, and an explicit privacy/compliance review. Twilio notes that Agent Connect is not a HIPAA-eligible or PCI-compliant service, so callers should never be asked for medical or payment-card information.
