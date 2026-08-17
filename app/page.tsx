import { ClaimWorkspace } from "@/components/claim-workspace";
import { isBoxConfigured, listClaims } from "@/lib/box";
import { demoClaims } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  let claims = demoClaims;
  let connectionError: string | undefined;

  try {
    claims = await listClaims();
  } catch (error) {
    connectionError = error instanceof Error ? error.message : "Box could not be reached";
  }

  return (
    <ClaimWorkspace
      initialClaims={claims}
      demoMode={!isBoxConfigured()}
      connectionError={connectionError}
    />
  );
}
