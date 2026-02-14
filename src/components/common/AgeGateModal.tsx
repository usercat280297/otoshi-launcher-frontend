import { useEffect, useMemo, useState } from "react";
import Button from "./Button";

export type AgeGatePayload = {
  year: number;
  month: number;
  day: number;
  remember: boolean;
};

type AgeGateModalProps = {
  open: boolean;
  title: string;
  requiredAge: number;
  onConfirm: (payload: AgeGatePayload) => void;
  onCancel: () => void;
  error?: string | null;
  busy?: boolean;
};

const monthOptions = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

function buildYearOptions() {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let year = current; year >= 1900; year -= 1) {
    years.push(year);
  }
  return years;
}

export default function AgeGateModal({
  open,
  title,
  requiredAge,
  onConfirm,
  onCancel,
  error,
  busy
}: AgeGateModalProps) {
  const years = useMemo(buildYearOptions, []);
  const [month, setMonth] = useState<number | "">("");
  const [day, setDay] = useState<number | "">("");
  const [year, setYear] = useState<number | "">("");
  const [remember, setRemember] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMonth("");
      setDay("");
      setYear("");
      setRemember(true);
      setLocalError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleConfirm = () => {
    if (!month || !day || !year) {
      setLocalError("Please select your full birth date.");
      return;
    }
    setLocalError(null);
    onConfirm({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      remember
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-background-border bg-background p-8 shadow-xl">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
            Age verification
          </p>
          <h2 className="text-2xl font-semibold text-text-primary">{title}</h2>
          <p className="text-sm text-text-secondary">
            This content is intended for users aged {requiredAge}+.
          </p>
        </div>

        <div className="mt-6 space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
            Enter your date of birth
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-2 text-xs text-text-muted">
              Month
              <select
                value={month}
                onChange={(event) => setMonth(Number(event.target.value) || "")}
                className="input-field"
              >
                <option value="">Select</option>
                {monthOptions.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-xs text-text-muted">
              Day
              <select
                value={day}
                onChange={(event) => setDay(Number(event.target.value) || "")}
                className="input-field"
              >
                <option value="">Select</option>
                {Array.from({ length: 31 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-xs text-text-muted">
              Year
              <select
                value={year}
                onChange={(event) => setYear(Number(event.target.value) || "")}
                className="input-field"
              >
                <option value="">Select</option>
                {years.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Remember for 30 days on this device.
          </label>
        </div>

        {(localError || error) && (
          <p className="mt-4 text-sm text-accent-red">{localError || error}</p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            size="lg"
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? "Verifying..." : "View content"}
          </Button>
          <Button size="lg" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
