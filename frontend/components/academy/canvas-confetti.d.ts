declare module "canvas-confetti" {
  type Fire = (options?: Record<string, unknown>) => Promise<null> | null;
  const confetti: Fire & { create: (canvas: HTMLCanvasElement, options?: { resize?: boolean; useWorker?: boolean }) => Fire };
  export default confetti;
}
