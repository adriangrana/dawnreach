import { useEffect, useRef } from 'react';
import { createDawnreachGame } from './game/createDawnreachGame';

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let destroy: (() => void) | undefined;

    void createDawnreachGame(host).then((game) => {
      if (disposed) {
        game.destroy();
        return;
      }
      destroy = game.destroy;
    });

    return () => {
      disposed = true;
      destroy?.();
    };
  }, []);

  return (
    <main className="app-shell">
      <div className="topbar">
        <strong>Dawnreach</strong>
        <span>POC 0.1 — click-to-move</span>
      </div>
      <div ref={hostRef} className="game-host" />
      <div className="hint">Right click anywhere on the arena to move Alden.</div>
    </main>
  );
}
