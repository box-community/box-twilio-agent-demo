import { config as loadEnv } from "dotenv";
import {
  TAC,
  TACConfig,
  TACServer,
  VoiceChannel,
  type ConversationId,
  type ConversationSession,
} from "twilio-agent-connect";
import { saveClaimToBox } from "../../lib/box";
import { analyzeClaim, respondToCaller } from "../../lib/openai";
import type { TranscriptTurn } from "../../lib/types";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const voiceBasePath = "/voice";

// Vercel provides the deployment hostname. An explicit value still wins, which
// is useful for a custom domain and for an ngrok tunnel during local testing.
process.env.TWILIO_VOICE_PUBLIC_DOMAIN ||= process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
process.env.TWILIO_VOICE_WEBSOCKET_PATH ||= `${voiceBasePath}/ws`;
process.env.TWILIO_VOICE_ACTION_PATH ||= `${voiceBasePath}/conversation-relay-callback`;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required by the voice service`);
  return value;
}

const greeting =
  "Thank you for calling Harbor Home claims. I’m Harbor, the automated intake assistant. Before we begin, is everyone safe?";

const transcripts = new Map<string, TranscriptTurn[]>();

const tac = await TAC.create({
  config: new TACConfig({
    accountSid: requiredEnv("TWILIO_ACCOUNT_SID"),
    authToken: requiredEnv("TWILIO_AUTH_TOKEN"),
    apiKey: requiredEnv("TWILIO_API_KEY"),
    apiSecret: requiredEnv("TWILIO_API_SECRET"),
    phoneNumber: requiredEnv("TWILIO_PHONE_NUMBER"),
    voicePublicDomain: process.env.TWILIO_VOICE_PUBLIC_DOMAIN,
    voiceWebsocketPath: process.env.TWILIO_VOICE_WEBSOCKET_PATH,
    voiceActionPath: process.env.TWILIO_VOICE_ACTION_PATH,
  }),
});
const voiceChannel = new VoiceChannel(tac, {
  memoryMode: "once",
  defaultTwimlOptions: {
    welcomeGreeting: greeting,
    welcomeGreetingInterruptible: "speech",
    language: "en-US",
    interruptible: "speech",
    ignoreBackchannel: true,
  },
});

tac.registerChannel(voiceChannel);

tac.onMessageReady(
  async ({
    conversationId,
    message,
    abortSignal,
  }: {
    conversationId: ConversationId;
    message: string;
    abortSignal?: AbortSignal;
  }) => {
    const id = conversationId as string;
    const transcript = transcripts.get(id) || [{ role: "agent", text: greeting } satisfies TranscriptTurn];
    transcript.push({ role: "caller", text: message });
    transcripts.set(id, transcript);

    try {
      const answer = await respondToCaller(transcript, "", abortSignal);
      transcript.push({ role: "agent", text: answer });
      return answer;
    } catch (error) {
      if (abortSignal?.aborted) return null;
      console.error("Voice response failed:", error);
      const fallback = "I’m sorry, I had trouble processing that. Could you say it once more?";
      transcript.push({ role: "agent", text: fallback });
      return fallback;
    }
  },
);

tac.onConversationEnded(async ({ session }: { session: ConversationSession }) => {
  const id = session.conversationId as string;
  const transcript = transcripts.get(id);
  transcripts.delete(id);

  if (!transcript?.some((turn) => turn.role === "caller")) {
    console.info("Call ended before the caller provided a statement; no claim created.");
    return;
  }

  try {
    const claim = await analyzeClaim(transcript, { phone: session.authorInfo?.address });
    const saved = await saveClaimToBox(claim);
    console.info(`Created ${saved.claimNumber}${saved.boxFileId ? ` in Box file ${saved.boxFileId}` : ""}.`);
  } catch (error) {
    console.error("Claim finalization failed:", error);
  }
});

const server = new TACServer(tac, {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 8080),
  webhookPaths: {
    twiml: `${voiceBasePath}/twiml`,
  },
});

server.fastify.get(`${voiceBasePath}/health`, async () => ({ status: "ok", service: "harbor-voice" }));

await server.start();
