import { useCallback, useState } from "react";
import { OrderCard } from "./OrderCard.tsx";
import { usePlacedOrders } from "./hooks/usePlacedOrders.ts";

export function OrdersDashboardApp() {
  const { orders, loadError, loading, refresh } = usePlacedOrders();
  const [status, setStatus] = useState("");
  const [busyCheckoutId, setBusyCheckoutId] = useState<string | null>(null);

  const markShipped = useCallback(
    async (orderId: string, checkoutId: string) => {
      setBusyCheckoutId(checkoutId);
      setStatus("Calling shipping callback…");
      try {
        const res = await fetch("/api/shipping/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: orderId,
            checkout_id: checkoutId,
            status: "shipped",
          }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!res.ok) {
          setStatus(
            `Error ${res.status}: ${
              String(data.error ?? data.message ?? res.statusText)
            }`,
          );
          return;
        }
        if (!data.success) {
          const wh = data.webhook as { status?: number } | undefined;
          setStatus(
            `Platform rejected webhook (HTTP ${wh?.status ?? "?"}): ` +
              String(data.platform_response ?? "").slice(0, 200),
          );
          return;
        }
        setStatus("Webhook accepted. Refreshing…");
        await refresh();
        setStatus("");
      } catch (e) {
        setStatus(String((e as Error).message ?? e));
      } finally {
        setBusyCheckoutId(null);
      }
    },
    [refresh],
  );

  return (
    <>
      <header>
        <h1>Placed orders</h1>
        <p>
          Checkout sessions with a successful payment. Use{" "}
          <strong>Mark as shipped</strong> to call{" "}
          <code>POST /api/shipping/callback</code>, which forwards a signed
          order event to the platform webhook from{" "}
          <code>dev.ucp.shopping.order</code>{" "}
          (negotiated via UCP-Agent profile).
        </p>
      </header>
      <main>
        <div className="toolbar">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh
          </button>
          <span className="hint">
            {loading ? "Loading…" : status}
          </span>
        </div>
        {loadError
          ? (
            <div className="error">
              Failed to load orders: {loadError}
            </div>
          )
          : orders && orders.length === 0
          ? (
            <div className="empty">
              No placed orders yet. Complete a checkout with Vipps to see rows
              here.
            </div>
          )
          : orders
          ? (
            orders.map((o) => (
              <OrderCard
                key={o.checkout_id}
                order={o}
                busy={busyCheckoutId === o.checkout_id}
                onMarkShipped={(orderId, checkoutId) => {
                  void markShipped(orderId, checkoutId);
                }}
              />
            ))
          )
          : null}
      </main>
    </>
  );
}
