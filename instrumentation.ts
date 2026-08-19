export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureBoxStructureInBox } = await import("@/lib/box");
  await ensureBoxStructureInBox();
}
