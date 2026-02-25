const VIP_ROLES = new Set(["admin", "vip"]);
const MEMBERSHIP_TIERS = new Set(["vip", "supporter_plus", "supporter"]);

function normalize(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function parseExpiry(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function isMembershipActive(
  membershipExpiresAt?: string | null,
  now = new Date()
): boolean {
  const expiry = parseExpiry(membershipExpiresAt);
  if (!expiry) return false;
  return expiry.getTime() >= now.getTime();
}

export function resolveEffectiveMembershipTier(input: {
  membershipTier?: string | null;
  membershipExpiresAt?: string | null;
  role?: string | null;
}): string | null {
  const role = normalize(input.role);
  if (VIP_ROLES.has(role)) {
    return "vip";
  }

  const tier = normalize(input.membershipTier);
  if (!MEMBERSHIP_TIERS.has(tier)) {
    return null;
  }

  return isMembershipActive(input.membershipExpiresAt) ? tier : null;
}

export function membershipTierLabel(tier?: string | null): string {
  const normalized = normalize(tier);
  if (normalized === "vip") return "VIP";
  if (normalized === "supporter_plus") return "Supporter+";
  if (normalized === "supporter") return "Supporter";
  return "Free";
}
