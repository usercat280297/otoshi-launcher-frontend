import { useEffect, useMemo, useState } from "react";
import { Boxes, Repeat, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { useLibrary } from "../hooks/useLibrary";
import {
  createTradeOffer,
  craftInventoryBadge,
  dropInventoryCard,
  fetchInventory,
  fetchTrades,
  respondTrade
} from "../services/api";
import { InventoryItem, TradeOffer } from "../types";

export default function InventoryPage() {
  const { token } = useAuth();
  const { t } = useLocale();
  const { entries } = useLibrary();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [trades, setTrades] = useState<TradeOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [tradeTarget, setTradeTarget] = useState("");
  const [offeredItems, setOfferedItems] = useState("");
  const [requestedItems, setRequestedItems] = useState("");
  const [error, setError] = useState<string | null>(null);

  const defaultGameId = useMemo(() => entries[0]?.game.id, [entries]);

  const load = async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [inventoryData, tradeData] = await Promise.all([
        fetchInventory(token),
        fetchTrades(token)
      ]);
      setItems(inventoryData);
      setTrades(tradeData);
    } catch (err: any) {
      setError(err.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      load();
    }
  }, [token]);

  const handleDropCard = async () => {
    if (!token || !defaultGameId) return;
    const next = await dropInventoryCard(defaultGameId, token);
    setItems((prev) => [next, ...prev]);
  };

  const handleCraftBadge = async () => {
    if (!token || !defaultGameId) return;
    const next = await craftInventoryBadge(defaultGameId, token);
    setItems((prev) => [next, ...prev]);
  };

  const handleTradeCreate = async () => {
    if (!token) return;
    if (!tradeTarget || !offeredItems || !requestedItems) {
      setError("Fill in trade target and item ids.");
      return;
    }
    const offer = await createTradeOffer(token, {
      toUserId: tradeTarget,
      offeredItemIds: offeredItems.split(",").map((item) => item.trim()),
      requestedItemIds: requestedItems.split(",").map((item) => item.trim())
    });
    setTrades((prev) => [offer, ...prev]);
    setTradeTarget("");
    setOfferedItems("");
    setRequestedItems("");
  };

  const handleTradeAction = async (tradeId: string, action: "accept" | "decline" | "cancel") => {
    if (!token) return;
    const updated = await respondTrade(token, tradeId, action);
    setTrades((prev) => prev.map((trade) => (trade.id === updated.id ? updated : trade)));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-text-secondary">
        <Boxes size={18} />
        <p className="text-xs uppercase tracking-[0.4em]">Inventory</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-glow">Items and trades</h1>
          <p className="text-sm text-text-secondary">
            Manage trading cards, badges, and community drops.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="epic-button px-4 py-2 text-xs" onClick={handleDropCard}>
            <Sparkles size={14} />
            Card drop
          </button>
          <button className="epic-button-secondary px-4 py-2 text-xs" onClick={handleCraftBadge}>
            Craft badge
          </button>
        </div>
      </div>

      {error && <div className="glass-panel p-4 text-sm text-text-secondary">{error}</div>}

      {loading ? (
        <div className="glass-panel p-6 text-sm text-text-secondary">Loading inventory...</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="space-y-4">
            <h2 className="section-title">Items</h2>
            {items.length === 0 ? (
              <div className="glass-panel p-4 text-sm text-text-secondary">No items yet.</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((item) => (
                  <div key={item.id} className="glass-card space-y-2 p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-text-muted">{item.itemType}</p>
                    <h3 className="text-sm font-semibold">{item.name}</h3>
                    <div className="flex items-center justify-between text-xs text-text-secondary">
                      <span>{item.rarity}</span>
                      <span>x{item.quantity}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="section-title">Trades</h2>
            <div className="glass-panel space-y-3 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Create trade</p>
              <input
                className="input-field"
                placeholder={t("inventory.placeholder.target_user_id")}
                value={tradeTarget}
                onChange={(event) => setTradeTarget(event.target.value)}
              />
              <input
                className="input-field"
                placeholder={t("inventory.placeholder.offered_item_ids")}
                value={offeredItems}
                onChange={(event) => setOfferedItems(event.target.value)}
              />
              <input
                className="input-field"
                placeholder={t("inventory.placeholder.requested_item_ids")}
                value={requestedItems}
                onChange={(event) => setRequestedItems(event.target.value)}
              />
              <button className="epic-button w-full px-4 py-2 text-xs" onClick={handleTradeCreate}>
                <Repeat size={14} />
                Send offer
              </button>
            </div>
            {trades.length === 0 ? (
              <div className="glass-panel p-4 text-sm text-text-secondary">No trades yet.</div>
            ) : (
              <div className="space-y-3">
                {trades.map((trade) => (
                  <div key={trade.id} className="glass-card space-y-2 p-4">
                    <div className="flex items-center justify-between text-xs text-text-secondary">
                      <span>Status: {trade.status}</span>
                      <span>{trade.offeredItemIds.length} offered</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {trade.status === "pending" && (
                        <>
                          <button
                            className="epic-button px-3 py-1 text-[11px]"
                            onClick={() => handleTradeAction(trade.id, "accept")}
                          >
                            Accept
                          </button>
                          <button
                            className="epic-button-secondary px-3 py-1 text-[11px]"
                            onClick={() => handleTradeAction(trade.id, "decline")}
                          >
                            Decline
                          </button>
                          <button
                            className="text-xs text-text-muted"
                            onClick={() => handleTradeAction(trade.id, "cancel")}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
