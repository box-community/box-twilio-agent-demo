import "dotenv/config";
import {
  MemoryPromptBuilder,
  TAC,
  TACConfig,
  TACServer,
  VoiceChannel,
  type ConversationId,
  type ConversationSession,
  type TACMemoryResponse,
} from "twilio-agent-connect";
import { saveClaimToBox } from "../../lib/box";
import { analyzeClaim, respondToCaller } from "../../lib/openai";
import type { TranscriptTurn } from "../../lib/types";

const greeting =
  "Thank you for calling Harbor Home claims. I’m Harbor, the automated intake assistant. Before we begin, is everyone safe?";

const transcripts = new Map<string, TranscriptTurn[]>();

const tac = await TAC.create({ config: TACConfig.fromEnv() });
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
    memory,
    session,
    abortSignal,
  }: {
    conversationId: ConversationId;
    message: string;
    memory: TACMemoryResponse | undefined;
    session: ConversationSession;
    abortSignal?: AbortSignal;
  }) => {
    const id = conversationId as string;
    const transcript = transcripts.get(id) || [{ role: "agent", text: greeting } satisfies TranscriptTurn];
    transcript.push({ role: "caller", text: message });
    transcripts.set(id, transcript);

    try {
      const memoryContext = MemoryPromptBuilder.build(memory, session);
      const answer = await respondToCaller(transcript, memoryContext, abortSignal);
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
});

server.fastify.get("/health", async () => ({ status: "ok", service: "harbor-voice" }));

await server.start();
