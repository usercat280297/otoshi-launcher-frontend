import {
  DeltaPlanV2,
  DownloadSessionStateV2,
  ManifestV2,
  SelfHealRepairPlanV2,
  SelfHealReportV2,
} from "../types_v2";
import { getPreferredApiBase } from "./api";

type RequestOptions = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

async function requestV2<T>(
  path: string,
  options: RequestOptions = {},
  token?: string
): Promise<T> {
  const base = getPreferredApiBase().replace(/\/+$/, "");
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchManifestV2(
  slug: string,
  params?: { version?: string; channel?: string }
): Promise<ManifestV2> {
  const query = new URLSearchParams();
  if (params?.version) query.set("version", params.version);
  if (params?.channel) query.set("channel", params.channel);
  const suffix = query.toString();
  return requestV2<ManifestV2>(`/v2/manifests/${encodeURIComponent(slug)}${suffix ? `?${suffix}` : ""}`);
}

export async function createDownloadSessionV2(
  payload: {
    slug?: string;
    game_id?: string;
    app_id?: string;
    version?: string;
    channel?: string;
    method?: string;
    install_path?: string;
    create_subfolder?: boolean;
  },
  token: string
): Promise<DownloadSessionStateV2> {
  return requestV2<DownloadSessionStateV2>(
    "/v2/download-sessions",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function controlDownloadSessionV2(
  sessionId: string,
  action: "pause" | "resume" | "cancel",
  token: string
): Promise<DownloadSessionStateV2> {
  return requestV2<DownloadSessionStateV2>(
    `/v2/download-sessions/${encodeURIComponent(sessionId)}/control`,
    {
      method: "POST",
      body: JSON.stringify({ action }),
    },
    token
  );
}

export async function getDownloadSessionStateV2(
  sessionId: string,
  token: string
): Promise<DownloadSessionStateV2> {
  return requestV2<DownloadSessionStateV2>(
    `/v2/download-sessions/${encodeURIComponent(sessionId)}/state`,
    {},
    token
  );
}

export async function runSelfHealScanV2(payload: {
  install_path: string;
  slug?: string;
  version?: string;
  channel?: string;
  use_usn_delta?: boolean;
  max_workers?: number;
  manifest?: Record<string, unknown>;
}): Promise<SelfHealReportV2> {
  return requestV2<SelfHealReportV2>("/v2/self-heal/scan", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function applySelfHealV2(payload: {
  report_id?: string;
  scan_report?: Record<string, unknown>;
  slug?: string;
  version?: string;
  channel?: string;
  install_path?: string;
  dry_run?: boolean;
  manifest?: Record<string, unknown>;
}): Promise<SelfHealRepairPlanV2> {
  return requestV2<SelfHealRepairPlanV2>("/v2/self-heal/repair", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getUpdateDeltaV2(fromVersion: string, toVersion: string): Promise<DeltaPlanV2> {
  const query = new URLSearchParams();
  query.set("from", fromVersion);
  query.set("to", toVersion);
  return requestV2<DeltaPlanV2>(`/v2/updates/delta?${query.toString()}`);
}

export async function resolveCdnPathV2(path: string, options?: {
  channel?: string;
  signed?: boolean;
  ttl_seconds?: number;
}) {
  const query = new URLSearchParams();
  query.set("path", path);
  if (options?.channel) query.set("channel", options.channel);
  if (typeof options?.signed === "boolean") query.set("signed", String(options.signed));
  if (typeof options?.ttl_seconds === "number") query.set("ttl_seconds", String(options.ttl_seconds));
  return requestV2<{ origin: string; url: string; fallbacks: string[] }>(
    `/v2/cdn/resolve?${query.toString()}`
  );
}

