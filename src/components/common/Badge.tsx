type BadgeProps = {
  label: string;
  tone?: "primary" | "secondary" | "muted" | "danger";
};

const tones = {
  primary: "border-primary/40 text-primary bg-background-surface",
  secondary: "border-background-border text-text-secondary bg-background-muted",
  muted: "border-background-border text-text-muted bg-background-elevated",
  danger: "border-accent-red/40 text-accent-red bg-accent-red/10"
};

export default function Badge({ label, tone = "muted" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] ${
        tones[tone]
      }`}
    >
      {label}
    </span>
  );
}
