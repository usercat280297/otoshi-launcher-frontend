import { useEffect, useMemo, useState } from "react";

import { useLocale } from "../../context/LocaleContext";
import Button from "../common/Button";
import Modal from "../common/Modal";
import type { LaunchConfig } from "../../types";
import type { PlayOptions, RendererOption } from "../../utils/playOptions";

const baseRendererChoices: {
  id: RendererOption;
  label: string;
  description: string;
  recommended?: boolean;
}[] = [
  {
    id: "dx12",
    label: "DirectX 12",
    description: "Best performance on modern GPUs.",
    recommended: true
  },
  {
    id: "dx11",
    label: "DirectX 11",
    description: "Most compatible fallback for older drivers."
  },
  {
    id: "vulkan",
    label: "Vulkan",
    description: "Alternative backend for specific titles."
  },
  {
    id: "auto",
    label: "Auto",
    description: "Let the game decide its renderer."
  }
];

type PlayOptionsModalProps = {
  open: boolean;
  onClose: () => void;
  gameTitle: string;
  initialOptions?: PlayOptions | null;
  initialRequireAdmin?: boolean;
  adminPrefKnown?: boolean;
  launchConfig?: LaunchConfig | null;
  busy?: boolean;
  error?: string | null;
  onConfirm: (
    options: PlayOptions,
    rememberRenderer: boolean,
    launchPolicy: { requireAdmin: boolean; rememberAdmin: boolean }
  ) => void;
};

export default function PlayOptionsModal({
  open,
  onClose,
  gameTitle,
  initialOptions,
  initialRequireAdmin,
  adminPrefKnown,
  launchConfig,
  busy,
  error,
  onConfirm
}: PlayOptionsModalProps) {
  const { t } = useLocale();
  const [renderer, setRenderer] = useState<RendererOption>("dx12");
  const [overlayEnabled, setOverlayEnabled] = useState(true);
  const [rememberRenderer, setRememberRenderer] = useState(false);
  const [requireAdmin, setRequireAdmin] = useState(false);
  const [rememberAdmin, setRememberAdmin] = useState(false);

  const rendererChoices = useMemo(() => {
    const recommended = (launchConfig?.recommendedApi || "").toLowerCase();
    const priority = Array.isArray(launchConfig?.rendererPriority)
      ? launchConfig?.rendererPriority
      : [];
    const ordering = priority.length
      ? priority.filter((item) => item !== "auto")
      : ["dx12", "dx11", "vulkan"];
    const ordered = ordering
      .map((id) => baseRendererChoices.find((choice) => choice.id === id))
      .filter(Boolean) as typeof baseRendererChoices;
    const autoChoice = baseRendererChoices.find((choice) => choice.id === "auto");
    const merged = [...ordered, ...(autoChoice ? [autoChoice] : [])];
    return merged.map((choice) => ({
      ...choice,
      recommended: choice.id === recommended
    }));
  }, [launchConfig]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const recommended =
      (launchConfig?.recommendedApi || "").toLowerCase() as RendererOption;
    const fallback =
      recommended === "dx12" || recommended === "dx11" || recommended === "vulkan"
        ? recommended
        : "dx12";
    setRenderer(initialOptions?.renderer ?? fallback);
    setOverlayEnabled(
      initialOptions?.overlayEnabled ?? launchConfig?.overlayEnabled ?? true
    );
    setRememberRenderer(false);
    setRequireAdmin(Boolean(initialRequireAdmin));
    setRememberAdmin(!adminPrefKnown);
  }, [open, initialOptions, launchConfig, initialRequireAdmin, adminPrefKnown]);

  const selected = useMemo(
    () => rendererChoices.find((choice) => choice.id === renderer),
    [renderer, rendererChoices]
  );

  const handleConfirm = () => {
    onConfirm(
      { renderer, overlayEnabled },
      rememberRenderer,
      { requireAdmin, rememberAdmin }
    );
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={t("play_options.title")} size="md">
      <div className="space-y-6">
        <div>
          <p className="text-sm text-text-secondary">{t("play_options.launching")}</p>
          <h3 className="text-2xl font-semibold text-text-primary">{gameTitle}</h3>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold uppercase tracking-[0.3em] text-text-muted">
            Renderer priority
          </h4>
          <div className="grid gap-3">
            {rendererChoices.map((choice) => (
              <label
                key={choice.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border border-background-border px-4 py-3 transition hover:border-primary ${
                  renderer === choice.id ? "bg-background/60" : "bg-transparent"
                }`}
              >
                <input
                  type="radio"
                  name="renderer"
                  className="mt-1"
                  checked={renderer === choice.id}
                  onChange={() => setRenderer(choice.id)}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text-primary">{choice.label}</span>
                    {choice.recommended && (
                      <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-text-secondary">{choice.description}</p>
                </div>
              </label>
            ))}
          </div>
          {selected && (
            <p className="text-xs text-text-muted">
              Selected: {selected.label}. Some games may ignore renderer flags.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-background-border px-4 py-3">
          <div>
            <p className="font-semibold text-text-primary">Enable overlay</p>
            <p className="text-sm text-text-secondary">
              Toggle the in-game overlay for screenshots and shortcuts.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <input
              type="checkbox"
              checked={overlayEnabled}
              onChange={(event) => setOverlayEnabled(event.target.checked)}
            />
            {overlayEnabled ? "On" : "Off"}
          </label>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-background-border px-4 py-3">
          <div>
            <p className="font-semibold text-text-primary">Launch as administrator</p>
            <p className="text-sm text-text-secondary">
              Enable if this game needs elevated privileges on Windows.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <input
              type="checkbox"
              checked={requireAdmin}
              onChange={(event) => setRequireAdmin(event.target.checked)}
            />
            {requireAdmin ? "On" : "Off"}
          </label>
        </div>

        <label className="flex items-center gap-3 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={rememberRenderer}
            onChange={(event) => setRememberRenderer(event.target.checked)}
          />
          Remember renderer + overlay settings for this game
        </label>

        <label className="flex items-center gap-3 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={rememberAdmin}
            onChange={(event) => setRememberAdmin(event.target.checked)}
          />
          Remember admin launch preference for this game
        </label>

        {error && <p className="text-sm text-accent-red">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} loading={busy}>
            Play now
          </Button>
        </div>
      </div>
    </Modal>
  );
}

