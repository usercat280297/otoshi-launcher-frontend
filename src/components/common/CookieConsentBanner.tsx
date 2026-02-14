import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLocale } from "../../context/LocaleContext";
import Button from "./Button";

type ConsentDecision = "all" | "essential" | "custom";

type ConsentCategories = {
  essential: true;
  analytics: boolean;
  marketing: boolean;
};

type ConsentPayload = {
  version: number;
  decision: ConsentDecision;
  categories: ConsentCategories;
  updatedAt: string;
};

const STORAGE_KEY = "otoshi.cookie_consent";
const SESSION_KEY = "otoshi.cookie_consent.session";
const CURRENT_VERSION = 1;

const defaultCategories: ConsentCategories = {
  essential: true,
  analytics: false,
  marketing: false
};

const readStoredConsent = (): ConsentPayload | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConsentPayload;
  } catch {
    return null;
  }
};

const emitConsent = (payload: ConsentPayload | { decision: "session" }) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("otoshi:cookie-consent", { detail: payload }));
};

export default function CookieConsentBanner() {
  const { t } = useLocale();
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [analytics, setAnalytics] = useState(defaultCategories.analytics);
  const [marketing, setMarketing] = useState(defaultCategories.marketing);

  useEffect(() => {
    if (location.pathname.startsWith("/overlay")) {
      setVisible(false);
      return;
    }

    const stored = readStoredConsent();
    const hasSession = window.sessionStorage.getItem(SESSION_KEY) === "1";

    if (stored) {
      setAnalytics(Boolean(stored.categories.analytics));
      setMarketing(Boolean(stored.categories.marketing));
      setVisible(false);
      return;
    }

    if (hasSession) {
      setVisible(false);
      return;
    }

    setVisible(true);
  }, [location.pathname]);

  if (!visible) return null;

  const persistConsent = (decision: ConsentDecision, categories: ConsentCategories) => {
    const payload: ConsentPayload = {
      version: CURRENT_VERSION,
      decision,
      categories,
      updatedAt: new Date().toISOString()
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.sessionStorage.removeItem(SESSION_KEY);
    emitConsent(payload);
    setVisible(false);
  };

  const allowOnce = () => {
    window.sessionStorage.setItem(SESSION_KEY, "1");
    emitConsent({ decision: "session" });
    setVisible(false);
  };

  const acceptAll = () =>
    persistConsent("all", {
      essential: true,
      analytics: true,
      marketing: true
    });

  const acceptEssential = () =>
    persistConsent("essential", {
      essential: true,
      analytics: false,
      marketing: false
    });

  const saveCustom = () =>
    persistConsent("custom", {
      essential: true,
      analytics,
      marketing
    });

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 md:px-6 md:pb-6">
      <div className="glass-panel mx-auto w-full max-w-5xl px-5 py-4 md:px-6 md:py-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.35em] text-text-muted">
              {t("cookie.title")}
            </p>
            <p className="text-sm text-text-secondary">
              {t("cookie.body")}
            </p>
            <Link
              to="/privacy-policy"
              className="text-xs font-semibold text-primary transition hover:text-text-primary"
            >
              {t("cookie.learn_more")}
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
            <Button variant="secondary" size="sm" onClick={acceptEssential}>
              {t("cookie.reject")}
            </Button>
            <Button variant="secondary" size="sm" onClick={allowOnce}>
              {t("cookie.allow_once")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPreferences((prev) => !prev)}
            >
              {t("cookie.manage")}
            </Button>
            <Button size="sm" onClick={acceptAll}>
              {t("cookie.accept_all")}
            </Button>
          </div>
        </div>

        {showPreferences && (
          <div className="mt-4 grid gap-4 border-t border-background-border pt-4 text-sm text-text-secondary md:grid-cols-[1fr_auto] md:items-center">
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3">
                <span>{t("cookie.essential")}</span>
                <input type="checkbox" checked readOnly className="h-4 w-4 accent-primary" />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>{t("cookie.analytics")}</span>
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(event) => setAnalytics(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>{t("cookie.marketing")}</span>
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(event) => setMarketing(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <Button variant="secondary" size="sm" onClick={acceptEssential}>
                {t("cookie.reject")}
              </Button>
              <Button size="sm" onClick={saveCustom}>
                {t("cookie.save")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
