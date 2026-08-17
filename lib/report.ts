import type { Claim } from "@/lib/types";

function bullets(items: string[], fallback = "None reported") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

export function claimToMarkdown(claim: Claim): string {
  const transcript = claim.transcript
    .map((turn) => `**${turn.role === "caller" ? "Caller" : "Harbor"}:** ${turn.text}`)
    .join("\n\n");

  return `# First Notice of Loss — ${claim.claimNumber}

> Preliminary AI-assisted intake for human review. This report is not a coverage determination.

## Claim overview

| Field | Value |
| --- | --- |
| Claimant | ${claim.claimantName} |
| Phone | ${claim.phone} |
| Property | ${claim.propertyAddress} |
| Date of loss | ${claim.lossDate} |
| Loss type | ${claim.lossType} |
| Severity | ${claim.severity} |
| Filed | ${claim.filedAt} |

## What happened

${claim.summary}

### Affected areas

${bullets(claim.damageAreas)}

### Immediate risks

${bullets(claim.immediateRisks)}

## Preliminary policy analysis

**Assessment:** ${claim.coverageStatus}

${claim.coverageRationale}

**Applicable policy language**

${bullets(claim.policyReferences)}

**Potential deductible:** ${claim.deductible}

## Recommended next steps

${claim.nextSteps.map((item, index) => `${index + 1}. ${item}`).join("\n")}

## Adjuster notes

${bullets(claim.notes)}

## Call transcript

${transcript || "No transcript was retained."}
`;
}
