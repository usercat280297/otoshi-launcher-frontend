export type ManifestFileV2 = {
  path: string;
  size: number;
  hash?: string;
  file_id?: string;
  chunks?: Array<{
    index: number;
    hash: string;
    size: number;
    url: string;
    fallback_urls?: string[];
    compression?: string;
  }>;
};

export type ManifestV2 = {
  schema_version: string;
  slug: string;
  channel: string;
  version: string;
  generated_at: string;
  integrity: {
    algorithm: "SHA-256" | string;
    canonical_hash: string;
  };
  manifest: {
    game_id: string;
    slug: string;
    version: string;
    build_id: string;
    chunk_size: number;
    total_size?: number;
    compressed_size?: number;
    files: ManifestFileV2[];
  };
};

export type DownloadSessionStageV2 =
  | "manifest_fetch"
  | "plan_build"
  | "chunk_transfer"
  | "transfer_paused"
  | "verify"
  | "xdelta_optional"
  | "finalize"
  | "cancelled";

export type DownloadSessionV2 = {
  id: string;
  user_id?: string;
  download_id: string;
  game_id: string;
  slug: string;
  channel: string;
  method: string;
  version: string;
  status: string;
  stage: DownloadSessionStageV2 | string;
  install_path?: string | null;
  created_at: string;
  updated_at: string;
  meta?: Record<string, unknown>;
};

export type DownloadSessionStateV2 = {
  session: DownloadSessionV2;
  task?: {
    id: string;
    status: string;
    progress: number;
    downloaded_bytes: number;
    total_bytes: number;
    network_bps: number;
    disk_read_bps: number;
    disk_write_bps: number;
    updated_at?: string | null;
    game_id: string;
  } | null;
};

export type SelfHealFileEntryV2 = {
  path: string;
  expected_size: number;
  actual_size: number;
  expected_sha256?: string | null;
  actual_sha256?: string | null;
  fast_hash_blake3?: string | null;
  status: "ok" | "missing" | "corrupt" | "error";
  reason: string;
  modified_at?: number;
};

export type SelfHealReportV2 = {
  report_id: string;
  slug?: string | null;
  game_id?: string;
  version?: string;
  channel?: string;
  install_path: string;
  engine: "usn_delta" | "full_scan" | string;
  usn_delta_used: boolean;
  shadow_verification_queued: boolean;
  summary: {
    total_files: number;
    verified_files: number;
    missing_files: number;
    corrupt_files: number;
    error_files: number;
  };
  files: SelfHealFileEntryV2[];
  hot_fix_queue: string[];
};

export type SelfHealRepairPlanV2 = {
  report_id?: string;
  dry_run?: boolean;
  repair_plan: {
    repair_id: string;
    generated_at: string;
    strategy: string;
    queue_count: number;
    queue: Array<{
      path: string;
      expected_size?: number;
      expected_sha256?: string | null;
      strategy: string;
      reason?: string;
    }>;
  };
  applied?: boolean;
  message?: string;
};

export type DeltaPlanV2 = {
  from_version: string;
  to_version: string;
  delta_available: boolean;
  strategy: "chunk_plus_xdelta" | "full" | string;
  generated_at: string;
  plan: {
    mode: "delta" | "full_download" | string;
    reason?: string;
    xdelta_min_file_mb?: number;
    changed_entries?: number;
  };
  patch?: Record<string, unknown>;
};

