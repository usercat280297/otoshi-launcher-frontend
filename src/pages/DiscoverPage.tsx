import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clapperboard,
  ExternalLink,
  Play,
  RefreshCcw,
  Tags,
  Tv
} from "lucide-react";
import StoreSubnav from "../components/store/StoreSubnav";
import { useLocale } from "../context/LocaleContext";
import {
  fetchAnimeDetail,
  fetchAnimeEpisodeSources,
  fetchAnimeHome,
  searchAnimeCatalog
} from "../services/api";
import { AnimeDetail, AnimeEpisodeSource, AnimeHome, AnimeItem, SearchSuggestion } from "../types";
import { openExternal } from "../utils/openExternal";

export default function DiscoverPage() {
  const { t } = useLocale();
  const [animeHome, setAnimeHome] = useState<AnimeHome | null>(null);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);

  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<AnimeItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [selectedTagGroupId, setSelectedTagGroupId] = useState<string | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);

  const [selectedAnime, setSelectedAnime] = useState<AnimeItem | null>(null);
  const [animeDetail, setAnimeDetail] = useState<AnimeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [selectedEpisodeUrl, setSelectedEpisodeUrl] = useState<string | null>(null);
  const [episodeSource, setEpisodeSource] = useState<AnimeEpisodeSource | null>(null);
  const [episodeLoading, setEpisodeLoading] = useState(false);
  const [selectedServerIndex, setSelectedServerIndex] = useState(0);

  const loadAnimeHome = useCallback(async (refresh = false) => {
    setHomeLoading(true);
    setHomeError(null);
    try {
      const data = await fetchAnimeHome({ refresh, limitPerSection: 14 });
      setAnimeHome(data);

      if (data.menuTags.length > 0) {
        setSelectedTagGroupId((prev) => prev ?? data.menuTags[0].id);
      }

      const first =
        data.carousel[0] ??
        data.sections[0]?.items[0] ??
        null;
      if (first) {
        setSelectedAnime((prev) => prev ?? first);
      }
    } catch (err: any) {
      setHomeError(err?.message || t("discover.error_home"));
    } finally {
      setHomeLoading(false);
    }
  }, [t]);

  const loadAnimeDetail = useCallback(
    async (item: AnimeItem, syncSelection = true) => {
      if (syncSelection) {
        setSelectedAnime(item);
      }
      setAnimeDetail(null);
      setDetailLoading(true);
      setDetailError(null);
      setEpisodeSource(null);
      setSelectedEpisodeUrl(null);
      setSelectedServerIndex(0);
      try {
        const detail = await fetchAnimeDetail(item.detailUrl, 80);
        setAnimeDetail(detail);
        const firstEpisode = detail.episodes[0];
        if (firstEpisode) {
          setSelectedEpisodeUrl(firstEpisode.url);
        }
      } catch (err: any) {
        setDetailError(err?.message || t("discover.error_detail"));
      } finally {
        setDetailLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    void loadAnimeHome(false);
  }, [loadAnimeHome]);

  useEffect(() => {
    if (!selectedAnime) return;
    void loadAnimeDetail(selectedAnime, false);
  }, [selectedAnime, loadAnimeDetail]);

  useEffect(() => {
    const query = searchValue.trim();
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let canceled = false;
    setSearchLoading(true);

    const timer = window.setTimeout(() => {
      searchAnimeCatalog(query, { limit: 10 })
        .then((items) => {
          if (canceled) return;
          setSearchResults(items);
        })
        .catch(() => {
          if (canceled) return;
          setSearchResults([]);
        })
        .finally(() => {
          if (canceled) return;
          setSearchLoading(false);
        });
    }, 280);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [searchValue]);

  useEffect(() => {
    if (!selectedEpisodeUrl) {
      setEpisodeSource(null);
      setEpisodeLoading(false);
      return;
    }

    let canceled = false;
    setEpisodeLoading(true);
    fetchAnimeEpisodeSources(selectedEpisodeUrl)
      .then((data) => {
        if (canceled) return;
        setEpisodeSource(data);
        setSelectedServerIndex(0);
      })
      .catch(() => {
        if (canceled) return;
        setEpisodeSource(null);
      })
      .finally(() => {
        if (canceled) return;
        setEpisodeLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [selectedEpisodeUrl]);

  const menuGroups = animeHome?.menuTags ?? [];
  const selectedMenuGroup = useMemo(() => {
    if (!menuGroups.length) return null;
    if (!selectedTagGroupId) return menuGroups[0];
    return menuGroups.find((entry) => entry.id === selectedTagGroupId) ?? menuGroups[0];
  }, [menuGroups, selectedTagGroupId]);

  const carouselItems = useMemo(() => {
    if (animeHome?.carousel?.length) return animeHome.carousel;
    return animeHome?.sections?.[0]?.items ?? [];
  }, [animeHome]);

  useEffect(() => {
    if (!carouselItems.length) {
      setCarouselIndex(0);
      return;
    }
    if (carouselIndex > carouselItems.length - 1) {
      setCarouselIndex(0);
    }
  }, [carouselItems, carouselIndex]);

  useEffect(() => {
    if (carouselItems.length <= 1) return;
    const timer = window.setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % carouselItems.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [carouselItems.length]);

  const heroItem = carouselItems[carouselIndex] ?? selectedAnime ?? null;
  const detailEpisodes = animeDetail?.episodes ?? [];
  const serverGroups = episodeSource?.serverGroups ?? [];
  const activeServerGroup =
    serverGroups[selectedServerIndex] ?? serverGroups[0] ?? null;

  const suggestions: SearchSuggestion[] = useMemo(
    () =>
      searchResults.map((item) => ({
        id: `anime-${item.id}`,
        label: item.title,
        value: item.title,
        kind: "result",
        image: item.posterImage ?? null,
        meta: item.episodeLabel ?? item.sectionTitle ?? t("discover.anime")
      })),
    [searchResults, t]
  );

  return (
    <div className="space-y-7">
      <StoreSubnav
        placeholder={t("discover.search_placeholder")}
        activeTab="discover"
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onSearchSubmit={() => {
          const first = searchResults[0];
          if (first) {
            setSelectedAnime(first);
          }
        }}
        suggestions={suggestions}
        onSuggestionSelect={(item) => {
          const match = searchResults.find((entry) => entry.title === item.label);
          if (match) {
            setSelectedAnime(match);
          }
        }}
      />

      <section className="glass-panel space-y-3 p-3 md:p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-text-muted">
          <Tags size={12} />
          {t("discover.tags_title")}
        </div>
        <div className="flex flex-wrap gap-2">
          {menuGroups.map((group) => (
            <button
              key={group.id}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition md:text-xs ${
                selectedMenuGroup?.id === group.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-background-border text-text-secondary hover:border-primary"
              }`}
              onClick={() => setSelectedTagGroupId(group.id)}
            >
              {group.title}
            </button>
          ))}
        </div>
        {selectedMenuGroup && selectedMenuGroup.items.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedMenuGroup.items.map((tag) => (
              <button
                key={`${selectedMenuGroup.id}-${tag.id}`}
                className="rounded-lg border border-background-border bg-background-surface px-2.5 py-1 text-[11px] text-text-secondary transition hover:border-primary hover:text-text-primary md:text-xs"
                onClick={() => void openExternal(tag.href)}
              >
                {tag.label}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="relative overflow-hidden rounded-2xl border border-background-border bg-background-elevated">
        {heroItem && (heroItem.backgroundImage || heroItem.posterImage) && (
          <img
            src={heroItem.backgroundImage || heroItem.posterImage || ""}
            alt={heroItem.title}
            className="absolute inset-0 h-full w-full object-cover opacity-35"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/65" />

        <div className="relative z-10 grid gap-4 p-4 md:grid-cols-[1.35fr_0.95fr] md:p-5">
          <div className="space-y-4">
            <p className="epic-pill w-fit">{t("discover.carousel_label")}</p>
            <h2 className="text-2xl font-semibold leading-tight md:text-3xl">
              {heroItem?.title || t("discover.hero_fallback_title")}
            </h2>
            <p className="max-w-2xl text-[13px] text-text-secondary md:text-sm">
              {animeDetail?.description ||
                t("discover.hero_fallback_desc")}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-muted md:text-xs">
              {heroItem?.episodeLabel && (
                <span className="rounded-full border border-background-border px-2.5 py-0.5">
                  {heroItem.episodeLabel}
                </span>
              )}
              {heroItem?.ratingLabel && (
                <span className="rounded-full border border-background-border px-2.5 py-0.5">
                  {t("discover.score_prefix")} {heroItem.ratingLabel}
                </span>
              )}
              {animeDetail?.qualityLabel && (
                <span className="rounded-full border border-background-border px-2.5 py-0.5">
                  {animeDetail.qualityLabel}
                </span>
              )}
              {searchLoading && <span>{t("discover.searching")}</span>}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                className="epic-button px-3 py-1.5 text-xs font-semibold"
                onClick={() => {
                  if (heroItem) {
                    setSelectedAnime(heroItem);
                  }
                }}
              >
                <Clapperboard size={16} />
                {t("discover.open_detail")}
              </button>
              <button
                className="epic-button-secondary px-3 py-1.5 text-xs font-semibold"
                onClick={() => {
                  if (heroItem?.detailUrl) {
                    void openExternal(heroItem.detailUrl);
                  }
                }}
              >
                <ExternalLink size={16} />
                {t("discover.open_source_page")}
              </button>
              <button
                className="epic-button-secondary px-3 py-1.5 text-xs font-semibold"
                onClick={() => void loadAnimeHome(true)}
              >
                <RefreshCcw size={16} />
                {t("discover.refresh_feed")}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-[0.28em] text-text-muted md:text-xs">
              {t("discover.trending_now")}
            </p>
            <div className="grid grid-cols-2 gap-2 md:gap-3">
              {carouselItems.slice(0, 6).map((item, index) => (
                <button
                  key={`carousel-${item.id}-${index}`}
                  className={`overflow-hidden rounded-xl border transition ${
                    index === carouselIndex
                      ? "border-primary"
                      : "border-background-border hover:border-primary"
                  }`}
                  onClick={() => {
                    setCarouselIndex(index);
                    setSelectedAnime(item);
                  }}
                >
                  {item.posterImage ? (
                    <img
                      src={item.posterImage}
                      alt={item.title}
                      className="h-20 w-full object-cover md:h-24"
                    />
                  ) : (
                    <div className="flex h-20 items-center justify-center bg-background-muted md:h-24">
                      <Tv size={20} className="text-text-muted" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {homeError && (
        <div className="glass-panel p-4 text-sm text-accent-red">
          {homeError}
        </div>
      )}

      {homeLoading && !animeHome ? (
        <div className="glass-panel p-4 text-sm text-text-secondary">
          {t("discover.loading_catalog")}
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]">
          <div className="space-y-6">
            {(animeHome?.sections || []).map((section) => (
              <section key={section.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold md:text-lg">{section.title}</h3>
                  <p className="text-xs uppercase tracking-[0.28em] text-text-muted">
                    {section.items.length} {t("discover.items")}
                  </p>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-elegant">
                  {section.items.map((item) => (
                    <button
                      key={`${section.id}-${item.id}`}
                      className={`glass-card min-w-[150px] max-w-[150px] overflow-hidden text-left transition md:min-w-[170px] md:max-w-[170px] ${
                        selectedAnime?.detailUrl === item.detailUrl
                          ? "border-primary"
                          : "hover:border-primary"
                      }`}
                      onClick={() => setSelectedAnime(item)}
                    >
                      {item.posterImage ? (
                        <img
                          src={item.posterImage}
                          alt={item.title}
                          className="h-[210px] w-full object-cover md:h-[240px]"
                        />
                      ) : (
                        <div className="flex h-[210px] w-full items-center justify-center bg-background-muted text-text-muted md:h-[240px]">
                          <Tv size={24} />
                        </div>
                      )}
                      <div className="space-y-1 p-2.5">
                        <p className="line-clamp-2 text-[13px] font-semibold md:text-sm">
                          {item.title}
                        </p>
                        <p className="text-[11px] text-text-muted md:text-xs">
                          {item.episodeLabel || item.ratingLabel || t("discover.anime")}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <aside className="glass-panel h-fit space-y-3 p-3 md:p-4 xl:sticky xl:top-6">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-text-muted">
              <Play size={12} />
              {t("discover.detail_title")}
            </div>
            {detailLoading ? (
              <p className="text-sm text-text-secondary">{t("discover.loading_detail")}</p>
            ) : detailError ? (
              <p className="text-sm text-accent-red">{detailError}</p>
            ) : animeDetail ? (
              <div className="space-y-4">
                {animeDetail.bannerImage && (
                  <img
                    src={animeDetail.bannerImage}
                    alt={animeDetail.title}
                    className="h-32 w-full rounded-xl border border-background-border object-cover md:h-36"
                  />
                )}

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">{animeDetail.title}</h3>
                  {animeDetail.breadcrumbs.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {animeDetail.breadcrumbs.map((crumb) => (
                        <button
                          key={`${crumb.id}-${crumb.href}`}
                          className="rounded-full border border-background-border px-2.5 py-1 text-[11px] text-text-secondary transition hover:border-primary hover:text-text-primary"
                          onClick={() => void openExternal(crumb.href)}
                        >
                          {crumb.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {animeDetail.description && (
                    <p className="max-h-28 overflow-y-auto text-sm text-text-secondary scrollbar-elegant">
                      {animeDetail.description}
                    </p>
                  )}
                </div>

                {animeDetail.metadata.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.28em] text-text-muted">
                      {t("discover.metadata")}
                    </p>
                    <div className="grid gap-2">
                      {animeDetail.metadata.slice(0, 10).map((entry, index) => (
                        <div
                          key={`meta-${entry.key}-${index}`}
                          className="rounded-lg border border-background-border bg-background-surface px-3 py-2 text-xs"
                        >
                          <p className="text-text-muted">{entry.key}</p>
                          <p className="mt-0.5 text-text-primary">{entry.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.28em] text-text-muted">
                    {t("discover.episodes")}
                  </p>
                  <div className="max-h-48 space-y-2 overflow-y-auto pr-1 scrollbar-elegant">
                    {detailEpisodes.map((episode) => (
                      <button
                        key={episode.url}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                          selectedEpisodeUrl === episode.url
                            ? "border-primary bg-background-muted"
                            : "border-background-border hover:border-primary"
                        }`}
                        onClick={() => setSelectedEpisodeUrl(episode.url)}
                      >
                        {episode.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 border-t border-background-border pt-3">
                  <p className="text-xs uppercase tracking-[0.28em] text-text-muted">
                    {t("discover.server_groups")}
                  </p>
                  {episodeLoading ? (
                    <p className="text-sm text-text-secondary">
                      {t("discover.loading_server_data")}
                    </p>
                  ) : episodeSource ? (
                    <div className="space-y-3">
                      {serverGroups.length > 0 && (
                        <select
                          className="w-full rounded-lg border border-background-border bg-background-surface px-3 py-2 text-sm outline-none focus:border-primary"
                          value={selectedServerIndex}
                          onChange={(event) =>
                            setSelectedServerIndex(Number(event.target.value) || 0)
                          }
                        >
                          {serverGroups.map((group, index) => (
                            <option key={`${group.name}-${index}`} value={index}>
                              {group.name} ({group.episodes.length})
                            </option>
                          ))}
                        </select>
                      )}

                      {activeServerGroup && (
                        <div className="max-h-40 space-y-2 overflow-y-auto pr-1 scrollbar-elegant">
                          {activeServerGroup.episodes.map((episode) => (
                            <button
                              key={`${activeServerGroup.name}-${episode.url}`}
                              className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                                selectedEpisodeUrl === episode.url
                                  ? "border-primary bg-background-muted"
                                  : "border-background-border hover:border-primary"
                              }`}
                              onClick={() => setSelectedEpisodeUrl(episode.url)}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span>
                                  {t("discover.episode_prefix")} {episode.label}
                                </span>
                                <span className="text-text-muted">
                                  {episode.sourceKey?.toUpperCase() || "API"}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      <button
                        className="epic-button-secondary w-full px-3 py-2 text-sm"
                        onClick={() => void openExternal(episodeSource.url)}
                      >
                        <ExternalLink size={14} />
                        {t("discover.open_watch_page")}
                      </button>

                      {episodeSource.qualityLabel && (
                        <p className="text-xs text-text-secondary">
                          {t("discover.reported_quality")}:{" "}
                          <span className="font-semibold text-text-primary">
                            {episodeSource.qualityLabel}
                          </span>
                        </p>
                      )}

                      <p className="text-xs text-text-muted">
                        {t("discover.direct_links_note")}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-text-secondary">
                      {t("discover.select_episode_prompt")}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-secondary">
                {t("discover.select_anime_prompt")}
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
