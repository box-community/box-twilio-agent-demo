import { z } from "zod";

export const transcriptTurnSchema = z.object({
  role: z.enum(["caller", "agent"]),
  text: z.string(),
});

export const claimSchema = z.object({
  id: z.string(),
  claimNumber: z.string(),
  claimantName: z.string(),
  phone: z.string(),
  propertyAddress: z.string(),
  lossDate: z.string(),
  lossType: z.enum(["Water", "Fire", "Weather", "Theft", "Liability", "Other"]),
  summary: z.string(),
  damageAreas: z.array(z.string()),
  immediateRisks: z.array(z.string()),
  severity: z.enum(["Low", "Moderate", "High", "Critical"]),
  coverageStatus: z.enum(["Likely covered", "Partially covered", "Needs review", "Likely excluded"]),
  coverageRationale: z.string(),
  policyReferences: z.array(z.string()),
  deductible: z.string(),
  nextSteps: z.array(z.string()),
  notes: z.array(z.string()),
  transcript: z.array(transcriptTurnSchema),
  filedAt: z.string(),
  status: z.enum(["Needs review", "In review", "Approved", "Escalated"]),
  taskStatus: z.enum(["Pending", "Assigned", "Complete"]),
  boxFileId: z.string().optional(),
  boxUrl: z.string().url().optional(),
});

export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;
export type Claim = z.infer<typeof claimSchema>;

export const claimExtractionSchema = claimSchema.omit({
  id: true,
  claimNumber: true,
  filedAt: true,
  status: true,
  taskStatus: true,
  boxFileId: true,
  boxUrl: true,
  transcript: true,
});

export type ClaimExtraction = z.infer<typeof claimExtractionSchema>;
