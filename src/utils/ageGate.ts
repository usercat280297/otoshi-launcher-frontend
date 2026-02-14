type AgeGateRecord = {
  age: number;
  requiredAge: number;
  verifiedAt: string;
  expiresAt?: string;
};

const STORAGE_PREFIX = "otoshi.age_gate";
const DEFAULT_REQUIRED_AGE = 18;
const DEFAULT_TTL_DAYS = 30;

function buildKey(scope: string) {
  return `${STORAGE_PREFIX}:${scope}`;
}

function parseRecord(raw: string | null): AgeGateRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AgeGateRecord;
    if (!parsed || typeof parsed.age !== "number") {
      return null;
    }
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function resolveRequiredAge(value?: number | null) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(numeric, DEFAULT_REQUIRED_AGE);
}

export function isAgeGateAllowed(scope: string, requiredAge: number) {
  if (requiredAge <= 0) return true;
  const key = buildKey(scope);
  const record =
    parseRecord(sessionStorage.getItem(key)) ||
    parseRecord(localStorage.getItem(key));
  if (!record) return false;
  return record.age >= requiredAge;
}

export function storeAgeGate(
  scope: string,
  age: number,
  requiredAge: number,
  remember: boolean
) {
  const now = new Date();
  const record: AgeGateRecord = {
    age,
    requiredAge,
    verifiedAt: now.toISOString()
  };
  if (remember) {
    const expires = new Date(now);
    expires.setDate(expires.getDate() + DEFAULT_TTL_DAYS);
    record.expiresAt = expires.toISOString();
    localStorage.setItem(buildKey(scope), JSON.stringify(record));
  } else {
    sessionStorage.setItem(buildKey(scope), JSON.stringify(record));
  }
}

export function clearAgeGate(scope: string) {
  localStorage.removeItem(buildKey(scope));
  sessionStorage.removeItem(buildKey(scope));
}
