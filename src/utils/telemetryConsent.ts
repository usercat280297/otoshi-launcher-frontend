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

type TelemetryConsentSource = "session" | "stored" | "none";

export type TelemetryConsentState = {
  allowed: boolean;
  source: TelemetryConsentSource;
  decision?: ConsentDecision;
};

const CONSENT_STORAGE_KEY = "otoshi.cookie_consent";
const CONSENT_SESSION_KEY = "otoshi.cookie_consent.session";
const SETTINGS_KEY = "otoshi.launcher.settings";

const parseConsent = (raw: string | null): ConsentPayload | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConsentPayload;
  } catch {
    return null;
  }
};

const resolveConsentAllowed = (consent: ConsentPayload | null): boolean => {
  if (!consent) return false;
  if (consent.decision === "all") return true;
  if (consent.decision === "custom") return Boolean(consent.categories?.analytics);
  return false;
};

const updateTelemetrySetting = (enabled: boolean) => {
  const stored = window.localStorage.getItem(SETTINGS_KEY);
  if (!stored) return;
  try {
    const data = JSON.parse(stored) as Record<string, unknown>;
    const privacy = (data.privacy as Record<string, unknown> | undefined) ?? {};
    const next = {
      ...data,
      privacy: {
        ...privacy,
        telemetry: enabled
      }
    };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Ignore malformed settings payloads.
  }
};

const emitTelemetrySetting = (state: TelemetryConsentState) => {
  window.dispatchEvent(
    new CustomEvent("otoshi:telemetry-setting", {
      detail: {
        enabled: state.allowed,
        source: state.source,
        decision: state.decision
      }
    })
  );
};

export const getTelemetryConsentState = (): TelemetryConsentState => {
  if (typeof window === "undefined") {
    return { allowed: false, source: "none" };
  }

  if (window.sessionStorage.getItem(CONSENT_SESSION_KEY) === "1") {
    return { allowed: true, source: "session" };
  }

  const consent = parseConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  return {
    allowed: resolveConsentAllowed(consent),
    source: consent ? "stored" : "none",
    decision: consent?.decision
  };
};

export const syncTelemetryWithConsent = (): TelemetryConsentState => {
  if (typeof window === "undefined") {
    return { allowed: false, source: "none" };
  }

  const state = getTelemetryConsentState();
  if (state.source === "stored" || state.source === "none") {
    updateTelemetrySetting(state.allowed);
  }
  emitTelemetrySetting(state);
  return state;
};
