import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TourStep = {
  id: string;
  title: string;
  description: string;
  selector: string;
};

type GuidedTourProps = {
  open: boolean;
  steps: TourStep[];
  index: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export default function GuidedTour({
  open,
  steps,
  index,
  onClose,
  onNext,
  onPrev
}: GuidedTourProps) {
  const step = steps[index];
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const clearHighlights = () => {
    const previous = document.querySelectorAll(".tour-highlight");
    previous.forEach((node) => node.classList.remove("tour-highlight"));
  };

  const updateTargetRect = () => {
    if (!step) return;
    const target = document.querySelector(step.selector) as HTMLElement | null;
    if (!target) {
      setTargetRect(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    setTargetRect(rect);
  };

  useEffect(() => {
    if (!open || !step) return;
    clearHighlights();
    const target = document.querySelector(step.selector) as HTMLElement | null;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      target.classList.add("tour-highlight");
    }
    const raf = window.requestAnimationFrame(updateTargetRect);
    const timer = window.setTimeout(updateTargetRect, 280);
    const handleScroll = () => updateTargetRect();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onNext();
      if (event.key === "ArrowLeft") onPrev();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
      window.removeEventListener("keydown", handleKey);
      clearHighlights();
    };
  }, [open, step, onClose, onNext, onPrev]);

  const tooltipStyle = useMemo(() => {
    if (!open) return {};
    const tooltip = tooltipRef.current?.getBoundingClientRect();
    const width = tooltip?.width ?? 320;
    const height = tooltip?.height ?? 180;
    const padding = 16;
    const headerOffset = 72;
    if (!targetRect) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)"
      };
    }
    let top = targetRect.bottom + 12;
    if (top + height + padding > window.innerHeight) {
      top = targetRect.top - height - 12;
    }
    top = clamp(top, headerOffset, window.innerHeight - height - padding);
    const left = clamp(
      targetRect.left,
      padding,
      window.innerWidth - width - padding
    );
    return { top, left };
  }, [open, targetRect]);

  if (!open || !step) return null;

  return createPortal(
    <>
      <div className="tour-root">
        <div className="tour-backdrop" onClick={onClose} />
        <div className="tour-spotlight" />
      </div>
      <div ref={tooltipRef} className="tour-tooltip" style={tooltipStyle}>
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
            Guided tour {index + 1}/{steps.length}
          </p>
          <button className="tour-skip" onClick={onClose}>
            Skip
          </button>
        </div>
        <h3 className="mt-3 text-xl font-semibold text-text-primary">{step.title}</h3>
        <p className="mt-2 text-sm text-text-secondary">{step.description}</p>
        <div className="mt-4 flex items-center justify-between">
          <button className="tour-nav" onClick={onPrev} disabled={index === 0}>
            Back
          </button>
          <button className="tour-next" onClick={onNext}>
            {index === steps.length - 1 ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
