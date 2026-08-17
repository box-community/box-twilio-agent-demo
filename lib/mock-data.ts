import type { Claim, TranscriptTurn } from "@/lib/types";

export const demoTranscript: TranscriptTurn[] = [
  {
    role: "agent",
    text: "Thank you for calling Harbor Home. I can help start your claim. First, is everyone safe?",
  },
  {
    role: "caller",
    text: "Yes, everyone is safe. A pipe burst under the upstairs bathroom sink early this morning.",
  },
  {
    role: "agent",
    text: "I’m glad everyone is safe. What damage can you see, and have you stopped the water?",
  },
  {
    role: "caller",
    text: "I shut off the main. Water came through the kitchen ceiling and soaked part of the wood floor. A plumber is on the way.",
  },
  {
    role: "agent",
    text: "Got it. Please tell me your name, the property address, and the best number to reach you.",
  },
  {
    role: "caller",
    text: "Maya Thompson, 1842 Alder Street in Portland, Oregon. My number is 503-555-0148.",
  },
];

export const demoClaims: Claim[] = [
  {
    id: "demo-water",
    claimNumber: "HH-260817-1042",
    claimantName: "Maya Thompson",
    phone: "(503) 555-0148",
    propertyAddress: "1842 Alder Street, Portland, OR 97205",
    lossDate: "2026-08-17",
    lossType: "Water",
    summary:
      "A supply line beneath an upstairs bathroom sink burst overnight. Water migrated through the kitchen ceiling and affected the hardwood floor below. The water main is off and a plumber is en route.",
    damageAreas: ["Upstairs bathroom vanity", "Kitchen ceiling", "Kitchen hardwood flooring"],
    immediateRisks: ["Trapped moisture above kitchen ceiling", "Potential electrical contact near ceiling light"],
    severity: "High",
    coverageStatus: "Likely covered",
    coverageRationale:
      "The reported event appears sudden and accidental. Resulting interior water damage is generally covered, while repair of the failed supply line itself may be excluded.",
    policyReferences: ["Section I – Perils Insured Against", "Water damage limitation", "Duties After Loss"],
    deductible: "$1,500 all-peril deductible",
    nextSteps: [
      "Avoid the affected ceiling area and switch off the nearby light circuit if safe.",
      "Begin professional water mitigation and retain invoices.",
      "Photograph all affected rooms before removing damaged material.",
    ],
    notes: ["Priority review: potential electrical exposure", "Plumber already dispatched", "No temporary lodging requested"],
    transcript: demoTranscript,
    filedAt: "2026-08-17T09:42:00-07:00",
    status: "Needs review",
    taskStatus: "Assigned",
    boxFileId: "demo-98114",
    boxUrl: "https://app.box.com/",
  },
  {
    id: "demo-weather",
    claimNumber: "HH-260816-0931",
    claimantName: "Jordan Lee",
    phone: "(415) 555-0182",
    propertyAddress: "77 Crestline Drive, San Rafael, CA 94901",
    lossDate: "2026-08-16",
    lossType: "Weather",
    summary: "A windstorm lifted shingles along the west roof slope, allowing rain into the guest bedroom ceiling.",
    damageAreas: ["West roof slope", "Guest bedroom ceiling"],
    immediateRisks: ["Further rain intrusion"],
    severity: "Moderate",
    coverageStatus: "Likely covered",
    coverageRationale: "Wind damage and resulting rain intrusion appear consistent with covered direct physical loss.",
    policyReferences: ["Section I – Perils Insured Against", "Reasonable Repairs"],
    deductible: "$2,500 wind/hail deductible",
    nextSteps: ["Install a temporary tarp", "Obtain a licensed roofer’s assessment", "Photograph lifted shingles"],
    notes: ["No interior contents damage reported"],
    transcript: [],
    filedAt: "2026-08-16T15:18:00-07:00",
    status: "In review",
    taskStatus: "Pending",
  },
  {
    id: "demo-theft",
    claimNumber: "HH-260814-0817",
    claimantName: "Priya Shah",
    phone: "(206) 555-0199",
    propertyAddress: "508 Fern Avenue, Seattle, WA 98109",
    lossDate: "2026-08-14",
    lossType: "Theft",
    summary: "Caller reported a forced-entry burglary with electronics and jewelry missing from the residence.",
    damageAreas: ["Rear door and frame", "Primary bedroom"],
    immediateRisks: [],
    severity: "Moderate",
    coverageStatus: "Partially covered",
    coverageRationale: "Theft is covered, subject to proof of loss and special sublimits that may apply to jewelry.",
    policyReferences: ["Personal Property Coverage", "Special Limits of Liability", "Duties After Loss"],
    deductible: "$1,500 all-peril deductible",
    nextSteps: ["Upload the police report", "Provide purchase records", "Secure the rear entry"],
    notes: ["Jewelry sublimit review required"],
    transcript: [],
    filedAt: "2026-08-14T11:04:00-07:00",
    status: "Approved",
    taskStatus: "Complete",
  },
];

export function newDemoClaim(): Claim {
  return {
    ...demoClaims[0],
    id: `demo-${Date.now()}`,
    claimNumber: `HH-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${Math.floor(1000 + Math.random() * 9000)}`,
    filedAt: new Date().toISOString(),
    boxFileId: undefined,
    boxUrl: undefined,
  };
}
