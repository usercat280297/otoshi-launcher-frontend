import type { ReactNode } from "react";
import { openExternal } from "../../utils/openExternal";

// Toggle this to quickly re-enable Revolut support in the future.
const REVOLUT_SUPPORT_ENABLED = false;

type DonateButton = {
  id: "kofi" | "revolut";
  href: string;
  label: string;
  className: string;
  enabled?: boolean;
  icon: ReactNode;
};

const DONATE_BUTTONS: DonateButton[] = [
  {
    id: "kofi",
    href: "https://ko-fi.com/0xolemon",
    label: "Support on Ko-fi",
    className:
      "bg-gradient-to-r from-[#7be3df] via-[#6d8eff] to-[#a855f7] text-white shadow-[0_12px_28px_rgba(87,144,255,0.35)] hover:shadow-[0_14px_32px_rgba(133,102,255,0.42)]",
    icon: (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-[15px] font-black leading-none text-[#f97316]">
        K
      </span>
    ),
  },
  {
    id: "revolut",
    href: "https://revolut.me/lightningfast",
    label: "Support on Revolut",
    className:
      "bg-gradient-to-r from-[#0f172a] via-[#101827] to-[#4f46e5] text-white shadow-[0_12px_28px_rgba(15,23,42,0.4)] hover:shadow-[0_14px_32px_rgba(56,68,214,0.45)]",
    enabled: REVOLUT_SUPPORT_ENABLED,
    icon: (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-[18px] font-black leading-none text-black">
        R
      </span>
    ),
  },
];

export default function FixesDonateBar() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      {DONATE_BUTTONS.map((button) => {
        const isDisabled = button.enabled === false;

        return (
          <button
            key={button.id}
            type="button"
            disabled={isDisabled}
            aria-disabled={isDisabled}
            onClick={() => {
              if (isDisabled) return;
              void openExternal(button.href);
            }}
            className={`group inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${button.className} ${
              isDisabled
                ? "cursor-not-allowed opacity-60 saturate-0 brightness-75 shadow-none hover:translate-y-0 hover:shadow-none"
                : "hover:-translate-y-0.5"
            }`}
          >
            {button.icon}
            <span>{button.label}</span>
          </button>
        );
      })}
    </div>
  );
}
