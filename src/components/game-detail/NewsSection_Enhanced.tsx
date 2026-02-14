// Enhanced NewsSection Component for Steam News
// Updated to display structured patch notes and improved formatting
// File: frontend/src/components/game-detail/NewsSection_Enhanced.tsx

import { Newspaper, ExternalLink, Calendar, User, AlertCircle, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import type { SteamNewsItem, NewsPatchNote } from "../../types";
import { openExternal } from "../../utils/openExternal";
import Modal from "../common/Modal";

type NewsSectionProps = {
  news: SteamNewsItem[];
  appId: string;
  gameName: string;
};

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getRelativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`;
  return formatDate(timestamp);
}

// Improved text cleaning that preserves structure better
function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/\{STEAM_CLAN_IMAGE\}[^\s]*/g, "")
    .replace(/\[img\][^\[]*\[\/img\]/gi, "")
    .replace(/\[url=[^\]]*\]([^\[]*)\[\/url\]/gi, "$1")
    .replace(/\[h[1-6]\](.*?)\[\/h[1-6]\]/gi, "$1")
    .replace(/\[\*\]/g, "• ")
    .replace(/\[.*?\]/g, "")
    .trim()
    .slice(0, 300);
}

// Category icon selector
function getCategoryIcon(category: string) {
  const icons = {
    "Bug Fixes": AlertCircle,
    "Balance": Zap,
    "Features": Newspaper,
    "Performance": Zap,
    "System": AlertCircle,
  };
  return icons[category as keyof typeof icons] || AlertCircle;
}

// Category badge styling
function getCategoryStyle(category: string) {
  const styles = {
    "Bug Fixes": "bg-red-900/20 text-red-300 border-red-800",
    "Balance": "bg-yellow-900/20 text-yellow-300 border-yellow-800",
    "Features": "bg-green-900/20 text-green-300 border-green-800",
    "Performance": "bg-blue-900/20 text-blue-300 border-blue-800",
    "System": "bg-purple-900/20 text-purple-300 border-purple-800",
  };
  return styles[category as keyof typeof styles] || "bg-gray-900/20 text-gray-300 border-gray-800";
}

// Expanded formatted content rendering
function formatContent(content?: string | null): string[] {
  if (!content) return [];
  let text = content;
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\{STEAM_CLAN_IMAGE\}[^\s]*/g, "");
  text = text.replace(/\[img\][\s\S]*?\[\/img\]/gi, "");
  text = text.replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, "$1");
  text = text.replace(/\[h[1-6]\]([\s\S]*?)\[\/h[1-6]\]/gi, "\n$1\n");
  text = text.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, "$1");
  text = text.replace(/\[\*\]/g, "• ");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/\[.*?\]/g, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// New component for patch note display
function PatchNoteCard({ patches }: { patches: NewsPatchNote[] }) {
  return (
    <div className="space-y-3 mt-4 pt-4 border-t border-background-border">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Patch Details</p>
      
      {patches.map((patch, idx) => {
        const Icon = getCategoryIcon(patch.category);
        const categoryStyle = getCategoryStyle(patch.category);
        
        return (
          <div key={idx} className="space-y-2">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${categoryStyle}`}>
              <Icon size={14} />
              <span className="text-sm font-semibold">{patch.category}</span>
            </div>
            
            {patch.title && (
              <p className="text-sm font-medium text-text-primary pl-3">{patch.title}</p>
            )}
            
            {patch.content && (
              <p className="text-xs text-text-secondary pl-3 whitespace-pre-line leading-relaxed">
                {patch.content.split('\n').slice(0, 3).join('\n')}
                {patch.content.split('\n').length > 3 && '...'}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function NewsSection({ news, appId, gameName }: NewsSectionProps) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<SteamNewsItem | null>(null);

  if (!news || news.length === 0) {
    return null;
  }

  const displayNews = expanded ? news : news.slice(0, 5);
  const selectedContent = useMemo(
    () => formatContent(selectedItem?.structured_content?.cleaned || selectedItem?.contents),
    [selectedItem]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Newspaper size={16} className="text-accent-green" />
          <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
            News & Updates
          </p>
        </div>
        <span className="text-xs text-text-muted">{news.length} updates</span>
      </div>

      <div className="space-y-3">
        {displayNews.map((item, index) => {
          const isHovered = hoveredItem === item.gid;
          const isRecent = item.date > 0 && (Date.now() / 1000 - item.date) < 604800;
          const previewImage = item.image || (item.images && item.images[0]) || null;
          const hasPatchNotes = item.patch_notes && item.patch_notes.length > 0;

          return (
            <button
              type="button"
              key={item.gid}
              onClick={() => setSelectedItem(item)}
              onMouseEnter={() => setHoveredItem(item.gid)}
              onMouseLeave={() => setHoveredItem(null)}
              className={`group relative block w-full text-left rounded-lg border p-4 transition-all duration-200 ${
                isHovered
                  ? "border-primary bg-primary/5 shadow-lg scale-[1.01]"
                  : "border-background-border bg-background-surface hover:border-primary/50"
              }`}
            >
              {/* Badges */}
              <div className="absolute top-3 right-3 flex gap-2">
                {isRecent && index === 0 && (
                  <span className="rounded-full bg-accent-green px-2 py-0.5 text-[10px] font-semibold text-black">
                    NEW
                  </span>
                )}
                {hasPatchNotes && (
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    PATCH
                  </span>
                )}
              </div>

              <div className="flex items-start justify-between gap-4">
                {previewImage && (
                  <div className="h-20 w-32 flex-shrink-0 overflow-hidden rounded-lg border border-background-border bg-background-muted">
                    <img
                      src={previewImage}
                      alt={item.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                )}
                
                <div className="min-w-0 flex-1">
                  <h4 className={`font-medium transition-colors duration-200 ${
                    isHovered ? "text-primary" : "text-text-primary"
                  }`}>
                    {item.title}
                  </h4>
                  
                  {/* Show preview with better formatting */}
                  {item.structured_content?.cleaned ? (
                    <p className={`mt-1 text-sm transition-colors duration-200 ${
                      isHovered ? "text-text-secondary line-clamp-3" : "text-text-muted line-clamp-2"
                    }`}>
                      {item.structured_content.cleaned.split('\n')[0]}...
                    </p>
                  ) : item.contents ? (
                    <p className={`mt-1 text-sm transition-colors duration-200 ${
                      isHovered ? "text-text-secondary line-clamp-3" : "text-text-muted line-clamp-2"
                    }`}>
                      {stripHtml(item.contents)}...
                    </p>
                  ) : null}

                  {/* Patch note categories preview */}
                  {hasPatchNotes && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.patch_notes!.slice(0, 3).map((patch, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-background-muted text-text-muted"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                          {patch.category}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-muted">
                    {item.date > 0 && (
                      <span className="flex items-center gap-1">
                        <Calendar size={11} />
                        {getRelativeTime(item.date)}
                      </span>
                    )}
                    {item.author && (
                      <span className="flex items-center gap-1">
                        <User size={11} />
                        {item.author}
                      </span>
                    )}
                    {item.feedLabel && (
                      <span className={`rounded-full px-2 py-0.5 transition-colors ${
                        isHovered ? "bg-primary/20 text-primary" : "bg-background-muted"
                      }`}>
                        {item.feedLabel}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  aria-label={t("news.open_article")}
                  onClick={(event) => {
                    event.stopPropagation();
                    void openExternal(item.url);
                  }}
                  className={`flex-shrink-0 rounded-md border border-transparent p-2 transition-all duration-200 ${
                    isHovered ? "text-primary opacity-100" : "text-text-muted opacity-0"
                  }`}
                >
                  <ExternalLink size={14} />
                </button>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4">
        {news.length > 5 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-primary transition hover:underline"
          >
            {expanded ? "Show less" : `Show all ${news.length} updates`}
          </button>
        )}
        <button
          type="button"
          onClick={() => void openExternal(`https://store.steampowered.com/news/app/${appId}`)}
          className="flex items-center gap-1 text-xs text-text-muted transition hover:text-text-primary"
        >
          View on Steam
          <ExternalLink size={11} />
        </button>
      </div>

      {/* Enhanced Modal with patch notes */}
      <Modal
        isOpen={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        title={selectedItem?.title}
        size="lg"
      >
        {selectedItem && (
          <div className="space-y-4">
            {(selectedItem.image || (selectedItem.images && selectedItem.images.length > 0)) && (
              <div className="overflow-hidden rounded-xl border border-background-border bg-background-muted">
                <img
                  src={selectedItem.image || selectedItem.images?.[0] || ""}
                  alt={selectedItem.title}
                  className="h-56 w-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
              {selectedItem.date > 0 && (
                <span className="flex items-center gap-1">
                  <Calendar size={12} />
                  {formatDate(selectedItem.date)}
                </span>
              )}
              {selectedItem.author && (
                <span className="flex items-center gap-1">
                  <User size={12} />
                  {selectedItem.author}
                </span>
              )}
              {selectedItem.feedLabel && (
                <span className="rounded-full bg-background-muted px-2 py-0.5">
                  {selectedItem.feedLabel}
                </span>
              )}
            </div>

            {/* Display structured content if available */}
            {selectedItem.structured_content?.cleaned ? (
              <div className="space-y-3 text-sm text-text-secondary">
                {selectedItem.structured_content.cleaned.split('\n').map((line, idx) => (
                  <p key={idx}>{line}</p>
                ))}
              </div>
            ) : selectedContent.length > 0 ? (
              <div className="space-y-3 text-sm text-text-secondary">
                {selectedContent.map((line, idx) => (
                  <p key={`${selectedItem.gid}-${idx}`}>{line}</p>
                ))}
              </div>
            ) : null}

            {/* Render patch notes if available */}
            {selectedItem.patch_notes && selectedItem.patch_notes.length > 0 && (
              <PatchNoteCard patches={selectedItem.patch_notes} />
            )}

            {selectedItem.images && selectedItem.images.length > 1 && (
              <div className="grid gap-3 md:grid-cols-2">
                {selectedItem.images.slice(1, 5).map((img, idx) => (
                  <div
                    key={`${selectedItem.gid}-img-${idx}`}
                    className="overflow-hidden rounded-lg border border-background-border"
                  >
                    <img
                      src={img}
                      alt={`${selectedItem.title} ${idx + 1}`}
                      className="h-40 w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void openExternal(selectedItem.url)}
                className="rounded-md border border-background-border px-4 py-2 text-sm text-text-primary transition hover:border-primary hover:text-primary"
              >
                View on Steam
              </button>
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="rounded-md border border-background-border px-4 py-2 text-sm text-text-muted transition hover:border-primary hover:text-text-primary"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
