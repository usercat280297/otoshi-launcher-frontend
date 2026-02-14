import { useEffect, useMemo, useState } from "react";

const formatClock = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function OverlayPage() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
    document.body.classList.add("overlay-mode");
    const root = document.getElementById("root");
    root?.classList.add("overlay-mode");
    return () => {
      document.documentElement.classList.remove("overlay-mode");
      document.body.classList.remove("overlay-mode");
      root?.classList.remove("overlay-mode");
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const clock = useMemo(() => formatClock(now), [now]);

  return (
    <div className="overlay-root">
      <div className="overlay-hud">
        <div className="overlay-title">OTOSHI OVERLAY</div>
        <div className="overlay-clock">{clock}</div>
        <div className="overlay-hint">Overlay is running as an external window.</div>
      </div>
    </div>
  );
}
