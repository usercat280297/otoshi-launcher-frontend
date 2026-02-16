import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useLocale } from "../context/LocaleContext";

const COLD_START_DURATION_MS = 1600;
const WARM_START_DURATION_MS = 180;
const WARM_START_WINDOW_MS = 1000 * 60 * 15;
const LAST_LAUNCH_TS_KEY = "otoshi.last_launch_ts";

export default function IntroPage() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const lastLaunch = Number(window.localStorage.getItem(LAST_LAUNCH_TS_KEY) || "0");
  const elapsed = Date.now() - lastLaunch;
  const warmStart = Number.isFinite(lastLaunch) && elapsed > 0 && elapsed <= WARM_START_WINDOW_MS;
  const introDurationMs = warmStart ? WARM_START_DURATION_MS : COLD_START_DURATION_MS;

  useEffect(() => {
    window.localStorage.setItem(LAST_LAUNCH_TS_KEY, String(Date.now()));
    const timer = window.setTimeout(() => {
      navigate("/store", { replace: true });
    }, introDurationMs);

    return () => window.clearTimeout(timer);
  }, [introDurationMs, navigate]);

  return (
    <button
      type="button"
      onClick={() => navigate("/store", { replace: true })}
      className="relative block h-screen w-screen overflow-hidden bg-black text-left"
      aria-label={t("intro.skip")}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(38,187,255,0.2),rgba(0,0,0,0.98)_58%)]" />

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-5">
        <motion.img
          src="/OTOSHI_icon.png"
          alt="Otoshi"
          className="h-24 w-24 rounded-2xl object-contain"
          initial={{ opacity: 0, scale: 0.78, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        />

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="text-center"
        >
          <p className="text-[11px] uppercase tracking-[0.45em] text-white/65">{t("intro.launcher")}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-wide text-white">Otoshi</h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-2 h-1.5 w-36 overflow-hidden rounded-full bg-white/10"
        >
          <motion.div
            className="h-full rounded-full bg-cyan-300/90"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: introDurationMs / 1000, ease: "linear" }}
          />
        </motion.div>
      </div>
    </button>
  );
}
