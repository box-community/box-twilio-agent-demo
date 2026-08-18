export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensurePolicyInBox } = await import("@/lib/box");
  await ensurePolicyInBox();
}
