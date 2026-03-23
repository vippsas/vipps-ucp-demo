import type { PlacedOrderSummary } from "./types.ts";

function fmtMoney(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

type Props = {
  order: PlacedOrderSummary;
  busy: boolean;
  onMarkShipped: (orderId: string, checkoutId: string) => void;
};

export function OrderCard({ order: o, busy, onMarkShipped }: Props) {
  const wh = o.last_order_event_webhook;
  const shipped = Boolean(wh);
  const ord = o.order;

  return (
    <section className="card">
      <h2>
        <span className={`badge ${shipped ? "shipped" : "pending"}`}>
          {shipped ? "Shipped" : "Pending fulfillment"}
        </span>
        <span>
          Order <code>{ord.id}</code>
        </span>
      </h2>
      <div className="meta">
        Checkout <code>{o.checkout_id}</code> · Session{" "}
        <code>{o.session_status}</code> · Ref <code>{ord.reference}</code>
      </div>
      {o.buyer?.name
        ? (
          <div className="meta">
            <strong>Buyer</strong> {o.buyer.name}
          </div>
        )
        : null}
      {o.shipping_address
        ? (
          <div className="meta">
            <strong>Ship to</strong> {o.shipping_address.name ?? ""},{" "}
            {o.shipping_address.line_one ?? ""},{" "}
            {o.shipping_address.postal_code ?? ""}{" "}
            {o.shipping_address.city ?? ""}
          </div>
        )
        : null}
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {(o.line_items ?? []).map((li) => {
            const title = li.item?.title ?? li.id;
            const unit = li.item?.price != null
              ? fmtMoney(li.item.price, o.currency)
              : "—";
            return (
              <tr key={li.id}>
                <td>{title}</td>
                <td>{li.quantity}</td>
                <td>{unit}</td>
              </tr>
            );
          })}
          {(o.totals ?? []).map((t, i) => (
            <tr key={`${t.type}-${i}`} className="totals">
              <td colSpan={2}>{t.type}</td>
              <td>{fmtMoney(t.amount, o.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shipped && wh
        ? (
          <div className="meta">
            Order event sent at {wh.notified_at} ·{" "}
            <a href={wh.tracking_url} target="_blank" rel="noopener noreferrer">
              {wh.carrier} · {wh.tracking_number}
            </a>{" "}
            · event <code>{wh.event_id}</code>
          </div>
        )
        : null}
      {!o.platform_webhook_configured
        ? (
          <p className="hint">
            No platform order webhook was stored for this session (checkout
            without UCP-Agent <code>dev.ucp.shopping.order</code>).
          </p>
        )
        : null}
      <div className="actions">
        {shipped
          ? <span className="hint">Platform webhook already notified.</span>
          : (
            <button
              type="button"
              className="primary"
              disabled={busy || !o.platform_webhook_configured}
              onClick={() => onMarkShipped(ord.id, o.checkout_id)}
            >
              Mark as shipped
            </button>
          )}
      </div>
    </section>
  );
}
