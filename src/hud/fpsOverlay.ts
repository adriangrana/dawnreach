const FPS_OVERLAY_ID = 'dawnreach-fps-overlay';
const FPS_SAMPLE_MS = 350;

export function mountFpsOverlay() {
  const existing = document.getElementById(FPS_OVERLAY_ID);
  existing?.remove();

  const element = document.createElement('div');
  element.id = FPS_OVERLAY_ID;
  element.textContent = 'FPS --';
  Object.assign(element.style, {
    position: 'fixed',
    top: '10px',
    right: '12px',
    zIndex: '12000',
    minWidth: '68px',
    padding: '5px 8px',
    border: '1px solid rgba(191, 220, 235, 0.28)',
    borderRadius: '5px',
    background: 'rgba(4, 10, 14, 0.72)',
    color: '#e9f5f8',
    fontFamily: 'Consolas, Menlo, monospace',
    fontSize: '12px',
    fontWeight: '700',
    lineHeight: '1',
    letterSpacing: '0.02em',
    textAlign: 'center',
    textShadow: '0 1px 2px #000',
    pointerEvents: 'none',
    userSelect: 'none',
  });
  document.body.appendChild(element);

  let frameId = 0;
  let frames = 0;
  let sampleStartedAt = performance.now();
  let smoothedFps = 60;
  let disposed = false;

  const frame = (now: number) => {
    if (disposed) return;
    frames += 1;
    const elapsed = now - sampleStartedAt;
    if (elapsed >= FPS_SAMPLE_MS) {
      const measured = frames * 1000 / Math.max(1, elapsed);
      smoothedFps += (measured - smoothedFps) * 0.45;
      const fps = Math.max(0, Math.round(smoothedFps));
      element.textContent = `FPS ${fps}`;
      element.style.color = fps >= 55 ? '#dff7e3' : fps >= 40 ? '#f5e7aa' : '#ffb2a8';
      frames = 0;
      sampleStartedAt = now;
    }
    frameId = requestAnimationFrame(frame);
  };

  frameId = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    cancelAnimationFrame(frameId);
    element.remove();
  };
}
