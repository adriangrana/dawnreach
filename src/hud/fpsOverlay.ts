const FPS_OVERLAY_ID = 'dawnreach-fps-overlay';
const FPS_SAMPLE_MS = 300;
const PEAK_HOLD_MS = 1_500;

export function mountFpsOverlay() {
  const existing = document.getElementById(FPS_OVERLAY_ID);
  existing?.remove();

  const element = document.createElement('div');
  element.id = FPS_OVERLAY_ID;
  element.textContent = 'FPS -- · -- ms';
  Object.assign(element.style, {
    position: 'fixed',
    top: '10px',
    right: '12px',
    zIndex: '12000',
    minWidth: '174px',
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
  let lastFrameAt = sampleStartedAt;
  let smoothedFps = 60;
  let samplePeakFrameMs = 0;
  let heldPeakFrameMs = 0;
  let peakHeldUntil = 0;
  let disposed = false;

  const frame = (now: number) => {
    if (disposed) return;

    const frameMs = Math.max(0, now - lastFrameAt);
    lastFrameAt = now;
    samplePeakFrameMs = Math.max(samplePeakFrameMs, frameMs);
    frames += 1;

    const elapsed = now - sampleStartedAt;
    if (elapsed >= FPS_SAMPLE_MS) {
      const measured = frames * 1000 / Math.max(1, elapsed);
      smoothedFps += (measured - smoothedFps) * 0.58;
      const fps = Math.max(0, Math.round(smoothedFps));
      const averageFrameMs = elapsed / Math.max(1, frames);

      if (samplePeakFrameMs >= heldPeakFrameMs || now >= peakHeldUntil) {
        heldPeakFrameMs = samplePeakFrameMs;
        peakHeldUntil = now + PEAK_HOLD_MS;
      }

      const peak = Math.round(heldPeakFrameMs);
      element.textContent = `FPS ${fps} · ${averageFrameMs.toFixed(1)} ms · MAX ${peak} ms`;
      element.title = 'FPS promedio reciente · tiempo medio por frame · peor frame retenido 1,5 s';

      if (heldPeakFrameMs >= 80 || fps < 35) element.style.color = '#ffb2a8';
      else if (heldPeakFrameMs >= 35 || fps < 55) element.style.color = '#f5e7aa';
      else element.style.color = '#dff7e3';

      frames = 0;
      sampleStartedAt = now;
      samplePeakFrameMs = 0;
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
