import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';

const BACKGROUND = 0x0b0f17;

export function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const app = new Application();
    let disposed = false;
    let mounted = false;

    void app
      .init({
        resizeTo: host,
        background: BACKGROUND,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      })
      .then(() => {
        // init() is async: under StrictMode the effect's cleanup can run before it
        // resolves, in which case this app is already unwanted.
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        host.appendChild(app.canvas);
        mounted = true;
      });

    return () => {
      disposed = true;
      if (mounted) app.destroy(true, { children: true });
    };
  }, []);

  return <div ref={hostRef} className="game-canvas" />;
}
