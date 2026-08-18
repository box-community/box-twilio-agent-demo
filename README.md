# Harbor FNOL Demo

A small Next.js and Twilio voice application that turns a homeowner's first-notice-of-loss (FNOL) call into a reviewable claim record in Box.

The caller speaks with an OpenAI-powered intake agent over a Twilio phone number. When the call ends, the app extracts structured claim data, compares the reported loss with a sample homeowners policy, uploads a Markdown report to Box, attaches metadata, and creates a human review task. The dashboard reads claims back from Box; there is no application database.

The complete application deploys as one Vercel project and one domain:

- the `web` service runs the Next.js dashboard and API routes;
- the `voice` container service runs Twilio Agent Connect and its WebSocket;
- Vercel routes `/voice/*` to the voice service and everything else to Next.js.

> This is a demonstration, not a production claims or coverage-decision system. All policy analysis is preliminary and requires human review. Vercel Services, container functions, and native WebSocket support are currently beta features.

## Prerequisites

- Node.js 22.13 or newer
- npm
- [Docker](https://docs.docker.com/get-docker/) for the complete local Vercel Services stack
- [Vercel CLI](https://vercel.com/docs/cli) and a [Vercel account](https://vercel.com/signup)
- [OpenAI API account](https://platform.openai.com/)
- [Twilio account](https://www.twilio.com/try-twilio) with a voice-capable phone number
- [Box developer account](https://account.box.com/signup/developer) with permission to create a Platform App
- A Box Admin or Co-Admin who can authorize the Platform App
- [ngrok](https://ngrok.com/download) or another public HTTPS/WebSocket tunnel for local voice testing

The dashboard can run without provider credentials. It uses bundled sample claims until Box is configured.

## 1. Install and configure the application

```bash
npm install
cp .env.example .env.local
```

Both local services read `.env.local`, so credentials only need to be configured once. The file is ignored by Git.

## 2. Configure OpenAI

Create an API key in the [OpenAI API dashboard](https://platform.openai.com/api-keys), then add it to `.env.local`:

```env
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-5.6
```

`OPENAI_MODEL` is optional and defaults to `gpt-5.6`. The key is used for live voice responses and for structured FNOL/policy analysis when a call ends.

## 3. Configure Box CCG

### Create and authorize the application

1. Open the [Box Developer Console](https://app.box.com/developers/console).
2. Select **Platform Apps**, then **New App**.
3. Choose **Client Credentials Grant**. The authentication method cannot be changed later.
4. Enable **Read and write all files and folders stored in Box** under Application Scopes.
5. Choose the application access level:
   - **App Access Only** is sufficient when reports live in the Service Account's folders and tasks remain unassigned.
   - **App + Enterprise Access** is needed to use an existing enterprise folder or assign tasks to managed users.
6. Submit the app for authorization. A Box Admin or Co-Admin must authorize it before CCG tokens work.
7. Copy the Client ID, Client Secret, and Enterprise ID from the app configuration.

All Box API calls are server-side, so a Box CORS-domain entry is not required.

### Add the credentials

```env
BOX_CLIENT_ID=your_client_id
BOX_CLIENT_SECRET=your_client_secret
BOX_ENTERPRISE_ID=your_enterprise_id
BOX_FOLDER_ID=0
BOX_REVIEWER_USER_ID=
```

| Variable | Required | Description |
| --- | --- | --- |
| `BOX_CLIENT_ID` | For Box mode | Client ID from the CCG Platform App. |
| `BOX_CLIENT_SECRET` | For Box mode | Client secret from the same CCG app. Keep it server-side. |
| `BOX_ENTERPRISE_ID` | For Box mode | Enterprise that authorized the app. |
| `BOX_FOLDER_ID` | Optional | Destination folder. Defaults to the Service Account root folder, `0`. |
| `BOX_REVIEWER_USER_ID` | Optional | Box user ID that receives each report's review task. |

The server exchanges the CCG values for a short-lived Service Account token and refreshes it automatically. If `BOX_FOLDER_ID` points outside the Service Account, add the Service Account as a collaborator. A configured reviewer must also be able to access that folder.

The demo uses Box's built-in `global/properties` metadata template, so no custom metadata template is required.

## 4. Configure Twilio Agent Connect

In the [Twilio Console](https://console.twilio.com/):

1. Copy the Account SID from the Console dashboard. It starts with `AC`.
2. Under **Develop → API Key & credentials → Auth Tokens**, copy the primary Auth Token.
3. Under **Develop → API Key & credentials → API Keys**, create a standard API key and save its `SK` SID and secret.
4. Buy or select a voice-capable phone number.

Add the values to `.env.local`:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_primary_auth_token
TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_SECRET=your_api_key_secret
TWILIO_PHONE_NUMBER=+15555550100
```

Use E.164 format for `TWILIO_PHONE_NUMBER`, including the leading `+` and country code.

### Optional Conversation Orchestrator memory

Conversation Orchestrator adds Twilio Conversation Memory and cross-call context:

1. Go to **Products & services → Conversation Orchestrator → Conversation configurations**.
2. Create a configuration for the phone number and select or create a Conversation Memory store.
3. Copy the ID, which starts with `conv_configuration_`.

```env
TWILIO_CONVERSATION_CONFIGURATION_ID=conv_configuration_xxxxxxxxxxxxxxxxxxxxxxxxxx
```

Leave this variable empty for the simplest voice-only demo.

## 5. Run locally

### Dashboard only

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). This mode does not require Docker, Twilio, or ngrok.

### Complete stack

Start a tunnel to the Vercel development gateway:

```bash
ngrok http 3000
```

Copy the public hostname and set it in `.env.local` without a protocol or path:

```env
TWILIO_VOICE_PUBLIC_DOMAIN=example.ngrok.app
```

Then start both Vercel services behind one local URL:

```bash
npm run dev:all
```

`dev:all` runs `vercel dev -L`, so it does not require a linked Vercel project. Keep Docker running because the deployed voice service is container-based.

Configure the Twilio phone number's incoming-call webhook as `POST`:

```text
https://example.ngrok.app/voice/twiml
```

Confirm the routed voice service is healthy:

```bash
curl https://example.ngrok.app/voice/health
```

Expected response:

```json
{"status":"ok","service":"harbor-voice"}
```

If Docker is unavailable, run `npm run dev` and `npm run voice:dev` in separate terminals, tunnel port `8080`, and use the same `/voice/twiml` webhook path.

## 6. Deploy to Vercel

The repository is already configured as a two-service Vercel application in `vercel.json`.

1. Import the repository as a new Vercel project.
2. In **Project Settings → Build and Deployment**, set **Framework Preset** to **Services**. This is required; leaving it as Next.js causes Vercel to ignore the `services` configuration.
3. Add the OpenAI, Box, and Twilio variables from `.env.example` under **Project Settings → Environment Variables**. Do not add `PORT` or `HOST`; Vercel supplies the container port.
4. Deploy from Git, or run:

   ```bash
   npm run deploy:production
   ```

5. After the production domain is active, set the Twilio phone-number webhook to:

   ```text
   https://your-project.vercel.app/voice/twiml
   ```

6. Verify the voice service:

   ```bash
   curl https://your-project.vercel.app/voice/health
   ```

`TWILIO_VOICE_PUBLIC_DOMAIN` may be left empty on Vercel; the voice service falls back to `VERCEL_PROJECT_PRODUCTION_URL`. Set it explicitly when using a custom domain or when you need to pin Twilio to a particular hostname. Use the hostname only, without `https://` or a path.

Every Git deployment builds the dashboard and voice service together, produces one preview URL, and can be rolled back atomically. WebSocket connections are subject to the Vercel Function duration limit for the project's plan, so this beta deployment is best suited to short demo calls.

## Usage

### Test without credentials

1. Run `npm run dev`.
2. Open [http://localhost:3000](http://localhost:3000).
3. Browse the bundled sample claims.
4. Click **Run demo call** to create another in-browser sample claim.

### Test OpenAI and Box without a phone call

1. Configure `OPENAI_API_KEY` and the three Box CCG credentials.
2. Start the dashboard.
3. Click **Run demo call**.

The app analyzes the bundled transcript, uploads the report to Box, attaches metadata, creates a review task, and opens the new claim in the dashboard.

### Test the complete phone flow

1. Start the full local stack or deploy it to Vercel.
2. Call the configured Twilio number.
3. Answer the intake questions and hang up when complete.
4. Wait a few seconds for OpenAI analysis and Box upload.
5. Refresh the dashboard and open the new claim.

The sample policy is [data/homeowners-policy.md](./data/homeowners-policy.md).

## Architecture

```text
One Vercel project and domain
  ├── /, /api/* → Next.js web service
  └── /voice/*  → Agent Connect container service
                       ↑
Homeowner → Twilio → /voice/twiml ↔ /voice/ws
                                      ↓
                               OpenAI interview
                                      ↓ call ends
                        structured FNOL + policy triage
                                      ↓
                              Box CCG Service Account
                               ├── Markdown report
                               ├── metadata
                               └── review task
                                      ↓
                           Next.js reads claims from Box
```

Box remains the claim system of record. The app has no database and the dashboard does not poll, so refresh it after a live call is processed.

## Routes

| Route | Method | Service | Purpose |
| --- | --- | --- | --- |
| `/` | `GET` | Web | Claims-desk dashboard. |
| `/api/claims` | `GET` | Web | Lists Box-backed claims or demo claims. |
| `/api/claims/demo` | `POST` | Web | Processes the bundled transcript and optionally saves it to Box. |
| `/voice/twiml` | `POST` | Voice | Returns TwiML that connects a call to Conversation Relay. |
| `/voice/ws` | WebSocket | Voice | Carries caller prompts and agent responses. |
| `/voice/conversation-relay-callback` | `POST` | Voice | Receives Conversation Relay completion events. |
| `/voice/webhook` | `POST` | Voice | Receives Agent Connect conversation events. |
| `/voice/health` | `GET` | Voice | Reports voice-service health. |

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run only the Next.js dashboard. |
| `npm run dev:all` | Run both services through the local Vercel gateway. |
| `npm run voice:dev` | Run only Agent Connect with file watching on port `8080`. |
| `npm run build` | Create a production Next.js build. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm run deploy` | Create a Vercel preview deployment. |
| `npm run deploy:production` | Create a Vercel production deployment. |

## Project structure

```text
twilio-box-agent/
├── app/                         # Next.js dashboard and APIs
├── components/                  # Claims-desk interface
├── data/homeowners-policy.md    # Sample policy
├── lib/                         # Box, OpenAI, reports, schemas, demo data
├── src/voice/server.ts          # Agent Connect Fastify server
├── Dockerfile.vercel            # Vercel voice container
├── vercel.json                  # Services and same-domain routing
├── .env.example                 # Configuration template
├── PROMPT.md                    # Minimal coding-agent brief
└── README.md
```

## Troubleshooting

### Vercel deploys only Next.js

Set the project's Framework Preset to **Services**, then redeploy. Vercel requires both that setting and the `services` key in `vercel.json`.

### `/voice/health` returns the Next.js 404 page

The deployment was not built in Services mode, or its current deployment predates `vercel.json`. Check the Framework Preset and redeploy.

### The dashboard says `Demo data`

All three CCG values must be present: `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, and `BOX_ENTERPRISE_ID`. Restart local development after changing `.env.local`.

### Box returns `unauthorized_client`

The enterprise Admin or Co-Admin has not authorized the CCG app. Scope or application-access changes also require reauthorization.

### Box returns `invalid_grant`

Verify that the client ID and secret belong to the same app and that `BOX_ENTERPRISE_ID` identifies the enterprise that authorized it.

### Box returns `403` or cannot find the folder

Confirm the app scope, the numeric `BOX_FOLDER_ID`, and that the CCG Service Account owns or collaborates on the destination folder.

### The Twilio call disconnects immediately

- Verify `/voice/health` on the same hostname used by Twilio.
- Confirm the incoming-call webhook ends in `/voice/twiml` and uses `POST`.
- Confirm `TWILIO_VOICE_PUBLIC_DOMAIN` is only a hostname.
- Check the `voice` service logs for credential or WebSocket-signature errors.

### The call works but no claim appears

Claim extraction and Box upload happen after call completion. Check the `voice` service logs, verify the OpenAI and Box environment variables, then refresh the dashboard.

## Production notes

- Add authentication and authorization before exposing claim data.
- Add durable post-call jobs and retries so an OpenAI or Box outage cannot lose a claim.
- Add retention, audit, encryption, redaction, and observability appropriate for insurance data.
- Replace in-memory call state before expecting concurrent or failure-tolerant production use.
- Replace the sample policy with controlled, versioned policy documents and require adjuster approval.
- Twilio Agent Connect is not a HIPAA-eligible or PCI-compliant service; never collect medical or payment-card information.

## Resources

- [Vercel Services](https://vercel.com/kb/guide/vercel-services)
- [Vercel WebSocket support](https://vercel.com/changelog/websocket-support-is-now-in-public-beta)
- [Vercel container images](https://vercel.com/blog/dockerfile-on-vercel)
- [Twilio Agent Connect quickstart](https://www.twilio.com/docs/conversations/agent-connect/quickstart)
- [Twilio Agent Connect channels and routes](https://www.twilio.com/docs/conversations/agent-connect/channels)
- [Twilio Conversation Orchestrator quickstart](https://www.twilio.com/docs/conversations/orchestrator/quickstart)
- [Box Client Credentials Grant setup](https://developer.box.com/guides/authentication/client-credentials/client-credentials-setup)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
