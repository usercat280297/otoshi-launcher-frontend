export type Game = {
  id: string;
  slug: string;
  steamAppId?: string;
  title: string;
  tagline: string;
  shortDescription?: string;
  description: string;
  studio: string;
  releaseDate: string;
  genres: string[];
  price: number;
  discountPercent: number;
  rating: number;
  requiredAge?: number;
  denuvo?: boolean;
  headerImage: string;
  capsuleImage?: string | null;
  heroImage: string;
  backgroundImage?: string;
  logoImage?: string;
  iconImage?: string;
  screenshots: string[];
  videos: MediaVideo[];
  systemRequirements: SystemRequirements;
  spotlightColor: string;
  installed: boolean;
  playtimeHours: number;
  isFavorite?: boolean;
};

export type MediaVideo = {
  url: string;
  thumbnail: string;
  hls?: string | null;
  dash?: string | null;
};

export type SystemRequirements = {
  minimum: RequirementProfile;
  recommended: RequirementProfile;
};

export type RequirementProfile = {
  os: string;
  processor: string;
  memory: string;
  graphics: string;
  storage: string;
};

export type AuthUser = {
  id: string;
  email: string;
  username: string;
  displayName?: string | null;
  role?: string | null;
};

export type OAuthProvider = {
  provider: string;
  label: string;
  enabled: boolean;
};

export type SteamGridDBAsset = {
  game_id: number;
  name: string;
  grid?: string | null;
  hero?: string | null;
  logo?: string | null;
  icon?: string | null;
};

export type SteamPrice = {
  initial?: number;
  final?: number;
  discountPercent?: number;
  currency?: string;
  formatted?: string | null;
  finalFormatted?: string | null;
};

export type SteamCatalogItem = {
  appId: string;
  name: string;
  shortDescription?: string | null;
  headerImage?: string | null;
  capsuleImage?: string | null;
  background?: string | null;
  artwork?: {
    t0?: string | null;
    t1?: string | null;
    t2?: string | null;
    t3?: string | null;
    t4?: string | null;
    version?: number;
  } | null;
  requiredAge?: number | null;
  denuvo?: boolean;
  price?: SteamPrice | null;
  genres?: string[];
  releaseDate?: string | null;
  platforms?: string[];
  itemType?: string | null;
  isDlc?: boolean;
  isBaseGame?: boolean;
  classificationConfidence?: number;
  artworkCoverage?: "sgdb" | "epic" | "steam" | "mixed";
  dlcCount?: number;
};

export type SteamIndexAssetInfo = {
  appId: string;
  selectedSource: string;
  assets: {
    grid?: string | null;
    hero?: string | null;
    logo?: string | null;
    icon?: string | null;
  };
  qualityScore?: number;
  version?: number;
};

export type SteamIndexIngestStatus = {
  latestJob: {
    id?: string | null;
    status: string;
    processedCount: number;
    successCount: number;
    failureCount: number;
    startedAt?: string | null;
    completedAt?: string | null;
    errorMessage?: string | null;
    externalEnrichment?: {
      steamdbSuccess: number;
      steamdbFailed: number;
      crossStoreSuccess: number;
      crossStoreFailed: number;
      completionProcessed?: number;
      completionFailed?: number;
      completionMetadataCreated?: number;
      completionAssetsCreated?: number;
      completionCrossStoreCreated?: number;
    };
  };
  totals: {
    titles: number;
    assets: number;
    steamdbEnrichment: number;
    crossStoreMappings: number;
  };
};

export type SteamIndexCoverage = {
  titlesTotal: number;
  metadataComplete: number;
  assetsComplete: number;
  crossStoreComplete: number;
  absoluteComplete: number;
};

export type RuntimeHealth = {
  status: string;
  sidecarReady: boolean;
  runtimeMode?: string;
  indexMode?: string;
  globalIndexV1?: boolean;
  dbPath?: string | null;
  dbExists?: boolean;
  ingestState?: string;
  lastError?: string | null;
};

export type RuntimeTuningProfile = "performance" | "balanced" | "power_save";

export type AsmCpuCapabilities = {
  arch: string;
  vendor: string;
  logicalCores: number;
  physicalCores: number;
  totalMemoryMb: number;
  availableMemoryMb: number;
  hasSse42: boolean;
  hasAvx2: boolean;
  hasAvx512: boolean;
  hasAesNi: boolean;
  hasBmi2: boolean;
  hasFma: boolean;
  featureScore: number;
  asmProbeTicks?: number | null;
  fallbackUsed: boolean;
};

export type RuntimeTuningRecommendation = {
  profile: RuntimeTuningProfile;
  decodeConcurrency: number;
  prefetchWindow: number;
  pollingFastMs: number;
  pollingIdleMs: number;
  animationLevel: string;
  reason: string;
  autoApplyAllowed: boolean;
  fallbackUsed: boolean;
};

export type RuntimeTuningApplyResult = {
  applied: boolean;
  profile: RuntimeTuningProfile;
  decodeConcurrency: number;
  prefetchWindow: number;
  pollingFastMs: number;
  pollingIdleMs: number;
  animationLevel: string;
  fallbackUsed: boolean;
  settingsPath: string;
  appliedAt: string;
};

export type SteamIndexAssetPrefetchResult = {
  total: number;
  processed: number;
  success: number;
  failed: number;
};

export type SteamIndexIngestRebuildResult = {
  jobId: string;
  processed: number;
  success: number;
  failed: number;
  steamdbSuccess?: number;
  steamdbFailed?: number;
  crossStoreSuccess?: number;
  crossStoreFailed?: number;
  completionProcessed?: number;
  completionFailed?: number;
  startedAt: string;
  completedAt: string;
};

export type SteamIndexCompletionResult = {
  processed: number;
  failed: number;
  metadataCreated: number;
  metadataUpdated: number;
  assetsCreated: number;
  assetsUpdated: number;
  crossStoreCreated: number;
  crossStoreUpdated: number;
};

export type PropertiesInstallInfo = {
  installed: boolean;
  installPath?: string | null;
  installRoots: string[];
  sizeBytes?: number | null;
  version?: string | null;
  branch?: string | null;
  buildId?: string | null;
  lastPlayed?: string | null;
  playtimeLocalHours?: number;
};

export type PropertiesHashMismatch = {
  path: string;
  expectedHash?: string | null;
  actualHash?: string | null;
  reason: string;
};

export type PropertiesVerifyResult = {
  success: boolean;
  totalFiles: number;
  verifiedFiles: number;
  corruptedFiles: number;
  missingFiles: number;
  manifestVersion?: string | null;
  mismatchFiles: PropertiesHashMismatch[];
};

export type PropertiesMoveResult = {
  success: boolean;
  newPath: string;
  progressToken: string;
  message: string;
};

export type PropertiesCloudSyncResult = {
  success: boolean;
  filesUploaded: number;
  filesDownloaded: number;
  conflicts: number;
  resolution: string[];
  eventId?: string | null;
};

export type PropertiesSaveLocations = {
  appId: string;
  locations: string[];
};

export type PropertiesLaunchOptions = {
  appId: string;
  userId?: string | null;
  launchOptions: Record<string, any>;
  updatedAt?: string | null;
};

export type PropertiesDlcState = {
  appId: string;
  title: string;
  installed: boolean;
  enabled: boolean;
  sizeBytes?: number | null;
  headerImage?: string | null;
};

export type SearchHistoryItem = {
  query: string;
  count: number;
  lastUsed?: string | null;
};

export type SearchSuggestion = {
  id: string;
  label: string;
  value: string;
  kind: "history" | "popular" | "result";
  image?: string | null;
  imageCandidates?: string[] | null;
  isDlc?: boolean;
  kindTag?: "DLC" | "BASE";
  artSource?: "sgdb" | "epic" | "steam" | "mixed";
  meta?: string | null;
  appId?: string | null;
};

export type AnimeItem = {
  id: string;
  title: string;
  detailUrl: string;
  posterImage?: string | null;
  backgroundImage?: string | null;
  episodeLabel?: string | null;
  ratingLabel?: string | null;
  sectionTitle?: string | null;
};

export type AnimeTagLink = {
  id: string;
  label: string;
  href: string;
};

export type AnimeTagGroup = {
  id: string;
  title: string;
  href?: string | null;
  items: AnimeTagLink[];
};

export type AnimeSection = {
  id: string;
  title: string;
  items: AnimeItem[];
};

export type AnimeHome = {
  source: string;
  menuTags: AnimeTagGroup[];
  carousel: AnimeItem[];
  sections: AnimeSection[];
  updatedAt?: string | null;
};

export type AnimeEpisode = {
  label: string;
  url: string;
};

export type AnimeMetadataEntry = {
  key: string;
  value: string;
};

export type AnimeDetail = {
  url: string;
  title: string;
  description?: string | null;
  coverImage?: string | null;
  bannerImage?: string | null;
  qualityLabel?: string | null;
  metadata: AnimeMetadataEntry[];
  breadcrumbs: AnimeTagLink[];
  episodes: AnimeEpisode[];
};

export type AnimeServerEpisode = {
  label: string;
  url: string;
  sourceKey?: string | null;
  playMode?: string | null;
  episodeId?: string | null;
  episodeHash?: string | null;
};

export type AnimeServerGroup = {
  name: string;
  episodes: AnimeServerEpisode[];
};

export type AnimeEpisodeSource = {
  url: string;
  title: string;
  qualityLabel?: string | null;
  serverGroups: AnimeServerGroup[];
  mediaUrls: string[];
  playerScripts: string[];
  playerHints: Record<string, any>;
};

export type FixOption = {
  link: string;
  name?: string | null;
  note?: string | null;
  version?: string | null;
  size?: number | null;
  recommended?: boolean;
};

export type FixEntry = {
  appId: string;
  name: string;
  steam?: SteamCatalogItem | null;
  options: FixOption[];
  denuvo?: boolean;
};

export type FixGuideStep = {
  title: string;
  description: string;
};

export type FixGuide = {
  title: string;
  summary?: string | null;
  steps: FixGuideStep[];
  warnings: string[];
  notes: string[];
  updatedAt?: string | null;
};

export type FixCategoryMeta = {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
};

export type FixEntryDetail = FixEntry & {
  kind: string;
  category?: FixCategoryMeta | null;
  guide: FixGuide;
};

export type FixCatalog = {
  total: number;
  offset: number;
  limit: number;
  items: FixEntry[];
};

export type DownloadMethod = {
  id: string;
  label: string;
  description?: string | null;
  note?: string | null;
  noteKey?: string | null;
  availabilityCode?: string | null;
  recommended?: boolean;
  enabled?: boolean;
};

export type DownloadVersion = {
  id: string;
  label: string;
  isLatest?: boolean;
  sizeBytes?: number | null;
};

export type DownloadOptions = {
  appId: string;
  name: string;
  sizeBytes?: number | null;
  sizeLabel?: string | null;
  methods: DownloadMethod[];
  versions: DownloadVersion[];
  onlineFix: FixOption[];
  bypass?: FixOption | null;
  installRoot: string;
  installPath: string;
  freeBytes?: number | null;
  totalBytes?: number | null;
};

export type ImageQualityMode = "fast" | "adaptive" | "high";

export type PerformanceSnapshot = {
  startupMs: number;
  interactiveMs: number;
  longTasks: number;
  fpsAvg: number;
  cacheHitRate: number;
  decodeMs: number;
  uploadMs: number;
};

export type GraphicsConfig = {
  id?: string | null;
  gameId: string;
  dx12Flags: string[];
  dx11Flags: string[];
  vulkanFlags: string[];
  overlayEnabled: boolean;
  recommendedApi?: string | null;
  executable?: string | null;
  gameDir?: string | null;
  source?: string | null;
};

export type LaunchConfig = {
  gameId: string;
  appId?: string | null;
  rendererPriority: string[];
  recommendedApi: string;
  overlayEnabled: boolean;
  flags: Record<string, string[]>;
  launchArgs: string[];
  executable?: string | null;
  gameDir?: string | null;
  source: string;
};

export type DownloadPreparePayload = {
  method: string;
  version: string;
  installPath: string;
  createSubfolder: boolean;
};

export type SteamMedia = {
  url: string;
  thumbnail?: string | null;
  hls?: string | null;
  dash?: string | null;
};

export type SteamGameDetail = SteamCatalogItem & {
  aboutTheGame?: string | null;
  aboutTheGameHtml?: string | null;
  detailedDescription?: string | null;
  detailedDescriptionHtml?: string | null;
  developers?: string[];
  publishers?: string[];
  categories?: string[];
  screenshots?: string[];
  movies?: SteamMedia[];
  pcRequirements?: {
    minimum?: string | null;
    recommended?: string | null;
  } | null;
  metacritic?: {
    score?: number | null;
    url?: string | null;
  } | null;
  recommendations?: number | null;
  website?: string | null;
  supportInfo?: {
    url?: string | null;
    email?: string | null;
  } | null;
  contentLocale?: string | null;
  gridImage?: string | null;
  heroImage?: string | null;
  logoImage?: string | null;
  iconImage?: string | null;
};

export type LibraryEntry = {
  id: string;
  game: Game;
  installedVersion?: string | null;
  playtimeHours: number;
};

export type DownloadTask = {
  id: string;
  sessionId?: string;
  protocol?: "v1" | "v2";
  title: string;
  progress: number;
  speed: string;
  speedMbps?: number;
  status: "queued" | "downloading" | "paused" | "verifying" | "completed" | "failed" | "cancelled";
  eta: string;
  etaMinutes?: number;
  gameId: string;
  gameSlug?: string;
  appId?: string;
  imageUrl?: string;
  iconUrl?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  networkBps?: number;
  diskReadBps?: number;
  diskWriteBps?: number;
  readBytes?: number;
  writtenBytes?: number;
  remainingBytes?: number;
  speedHistory?: number[];
  updatedAt?: number;
};

export type SignedLicense = {
  license_id: string;
  user_id: string;
  game_id: string;
  issued_at: string;
  expires_at?: string | null;
  max_activations: number;
  current_activations: number;
  hardware_id?: string | null;
  signature: string;
};

export type WorkshopItem = {
  id: string;
  gameId: string;
  creatorId: string;
  title: string;
  description?: string;
  itemType?: string;
  visibility: string;
  totalDownloads: number;
  totalSubscriptions: number;
  ratingUp: number;
  ratingDown: number;
  tags: string[];
  previewImageUrl?: string;
  createdAt: string;
  updatedAt: string;
  source?: string;
};

export type WorkshopVersion = {
  id: string;
  workshopItemId: string;
  version: string;
  changelog?: string;
  fileSize: number;
  downloadUrl?: string;
  createdAt: string;
};

export type WorkshopSubscription = {
  id: string;
  workshopItemId: string;
  subscribedAt: string;
  autoUpdate: boolean;
  item?: WorkshopItem;
};

export type LocalWorkshopInstall = {
  appId: string;
  itemId: string;
  path: string;
};

export type WorkshopSyncResult = {
  appId: string;
  targetDir: string;
  itemsTotal: number;
  itemsSynced: number;
  errors: string[];
};

export type WishlistEntry = {
  id: string;
  createdAt: string;
  game: Game;
};

export type InventoryItem = {
  id: string;
  userId: string;
  gameId?: string | null;
  itemType: string;
  name: string;
  rarity: string;
  quantity: number;
  metadata: Record<string, any>;
  createdAt: string;
};

export type TradeOffer = {
  id: string;
  fromUserId: string;
  toUserId: string;
  offeredItemIds: string[];
  requestedItemIds: string[];
  status: string;
  createdAt: string;
  expiresAt?: string | null;
};

export type ActivityEvent = {
  id: string;
  userId: string;
  eventType: string;
  payload: Record<string, any>;
  createdAt: string;
};

export type Review = {
  id: string;
  user: {
    id: string;
    username: string;
    displayName?: string | null;
  };
  gameId: string;
  rating: number;
  title?: string | null;
  body?: string | null;
  recommended: boolean;
  helpfulCount: number;
  createdAt: string;
};

export type UserProfile = {
  userId: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  backgroundImage?: string | null;
  socialLinks: Record<string, any>;
};

export type CommunityComment = {
  id: string;
  userId: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  message: string;
  appId?: string | null;
  appName?: string | null;
  createdAt: string;
};

export type Bundle = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  price: number;
  discountPercent: number;
  gameIds: string[];
};

export type DlcItem = {
  id: string;
  baseGameId: string;
  title: string;
  description?: string | null;
  price: number;
  isSeasonPass: boolean;
  releaseDate?: string | null;
};

export type Preorder = {
  id: string;
  status: string;
  preorderAt: string;
  preloadAvailable: boolean;
  game: Game;
};

export type RemoteDownload = {
  id: string;
  game: Game;
  targetDevice: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type DeveloperAnalytics = {
  gameId: string;
  metrics: Record<string, any>;
  createdAt: string;
};

export type DeveloperDepot = {
  id: string;
  gameId: string;
  name: string;
  platform: string;
  branch: string;
  createdAt: string;
};

export type DeveloperBuild = {
  id: string;
  depotId: string;
  version: string;
  manifest: Record<string, any>;
  createdAt: string;
};

// Steam Extended Types
export type SteamDLC = {
  appId: string;
  name: string;
  headerImage?: string | null;
  description?: string | null;
  releaseDate?: string | null;
  price?: SteamPrice | null;
};

export type SteamAchievement = {
  name: string;
  displayName: string;
  description?: string | null;
  icon?: string | null;
  iconGray?: string | null;
  hidden: boolean;
  globalPercent?: number | null;
};

export type NewsPatchNote = {
  title: string;
  content: string;
  category: string;
};

export type StructuredContent = {
  raw: string;
  cleaned: string;
  feed_label: string;
  has_media: boolean;
  intro?: string[];
  sections?: Array<{
    title?: string;
    bullets?: string[];
    paragraphs?: string[];
    subsections?: Array<{
      title?: string;
      bullets?: string[];
      paragraphs?: string[];
    }>;
  }>;
  meta?: {
    version?: string;
    update_time?: string;
  };
};

export type SteamNewsItem = {
  gid: string;
  title: string;
  url: string;
  author?: string | null;
  contents?: string | null;
  image?: string | null;
  images?: string[];
  feedLabel?: string | null;
  date: number;
  feedName?: string | null;
  tags: string[];
  patch_notes?: NewsPatchNote[] | null;
  structured_content?: StructuredContent | null;
};

export type SteamReviewSummary = {
  totalPositive: number;
  totalNegative: number;
  totalReviews: number;
  reviewScore: number;
  reviewScoreDesc: string;
};

export type SteamExtendedData = {
  appId: string;
  dlc: {
    items: SteamDLC[];
    total: number;
  };
  achievements: {
    items: SteamAchievement[];
    total: number;
  };
  news: {
    items: SteamNewsItem[];
    total: number;
  };
  playerCount?: number | null;
  reviews: SteamReviewSummary;
};
