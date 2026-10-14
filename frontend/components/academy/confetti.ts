/** Celebration burst, loaded on demand and skipped when the user prefers reduced motion.
 *  Runs on the main thread (no web worker): the site's CSP does not allow blob: workers. */
export async function celebrate(): Promise<void> {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const confetti = (await import("canvas-confetti")).default;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60";
  document.body.appendChild(canvas);
  const fire = confetti.create(canvas, { resize: true, useWorker: false });
  void fire({ particleCount: 90, spread: 70, origin: { y: 0.7 }, disableForReducedMotion: true });
  window.setTimeout(() => canvas.remove(), 4000);
}
