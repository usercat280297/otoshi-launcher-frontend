import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Ripple = {
  id: number;
  x: number;
  y: number;
};

export default function GlobalRipple() {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleId = useRef(0);

  useEffect(() => {
    const handlePointer = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-no-ripple]")) {
        return;
      }
      const id = rippleId.current++;
      setRipples((prev) => [...prev, { id, x: event.clientX, y: event.clientY }]);
    };

    window.addEventListener("pointerdown", handlePointer, { capture: true });
    return () => window.removeEventListener("pointerdown", handlePointer, { capture: true });
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="app-ripple-layer">
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="app-ripple"
          style={{ left: ripple.x, top: ripple.y }}
          onAnimationEnd={() =>
            setRipples((prev) => prev.filter((item) => item.id !== ripple.id))
          }
        />
      ))}
    </div>,
    document.body
  );
}
