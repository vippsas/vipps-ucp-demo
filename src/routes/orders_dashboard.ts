import { loadSessions } from "../infrastructure/sessions.ts";
import type { CheckoutSession } from "../types/ucp/checkout.ts";

function orderSummary(s: CheckoutSession) {
  return {
    checkout_id: s.id,
    session_status: s.status,
    currency: s.currency,
    order: s.order,
    line_items: s.line_items,
    totals: s.totals,
    buyer: s.buyer,
    shipping_address: s.shipping_address,
    platform_webhook_configured: Boolean(s.platform_webhook_url),
    merchant_fulfillment: s.merchant_fulfillment ?? null,
  };
}

/**
 * JSON list of checkout sessions that have a placed order (payment completed).
 */
export function handleListPlacedOrders(): Response {
  const orders = loadSessions()
    .filter((s) => s.order != null)
    .sort((a, b) => {
      const ta = a.order?.created_at ?? "";
      const tb = b.order?.created_at ?? "";
      return tb.localeCompare(ta);
    })
    .map(orderSummary);
  return Response.json({ orders });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Orders — UCP demo merchant</title>
  <style>
    :root {
      --bg: #0f1419;
      --surface: #1a222c;
      --border: #2d3a4a;
      --text: #e7edf4;
      --muted: #8b9cb0;
      --accent: #5b9fd4;
      --ok: #3d9e6e;
      --warn: #c9a227;
    }
    * { box-sizing: border-box; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      line-height: 1.5;
      min-height: 100vh;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding: 1.25rem 1.5rem;
      background: var(--surface);
    }
    header h1 {
      font-size: 1.15rem;
      font-weight: 600;
      margin: 0 0 0.35rem 0;
    }
    header p {
      margin: 0;
      color: var(--muted);
      font-size: 0.875rem;
      max-width: 42rem;
    }
    main { padding: 1.5rem; max-width: 960px; margin: 0 auto; }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
    }
    button, .btn {
      font: inherit;
      cursor: pointer;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      padding: 0.45rem 0.9rem;
    }
    button.primary {
      background: var(--accent);
      border-color: #4a8fc4;
      color: #0a0e12;
      font-weight: 600;
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .empty, .error {
      padding: 2rem;
      text-align: center;
      color: var(--muted);
      border: 1px dashed var(--border);
      border-radius: 8px;
    }
    .error { color: #e07a7a; border-style: solid; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .card h2 {
      font-size: 1rem;
      margin: 0 0 0.5rem 0;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.5rem 1rem;
    }
    .badge {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-weight: 600;
    }
    .badge.pending { background: #3a2f0a; color: var(--warn); }
    .badge.shipped { background: #0f2e1f; color: #6dcea3; }
    .meta {
      font-size: 0.8rem;
      color: var(--muted);
      margin-bottom: 1rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      margin: 0.75rem 0;
    }
    th, td {
      text-align: left;
      padding: 0.5rem 0.6rem;
      border-bottom: 1px solid var(--border);
    }
    th { color: var(--muted); font-weight: 500; }
    .totals td { border-bottom: none; }
    .actions { margin-top: 1rem; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
    .hint { font-size: 0.8rem; color: var(--muted); }
    code { font-size: 0.8em; background: #0d1117; padding: 0.1em 0.35em; border-radius: 4px; }
  </style>
</head>
<body>
  <header>
    <h1>Placed orders</h1>
    <p>Checkout sessions with a successful payment. Use <strong>Mark as shipped</strong> to call <code>POST /api/shipping/callback</code>, which forwards a signed order event to the platform webhook from <code>dev.ucp.shopping.order</code> (negotiated via UCP-Agent profile).</p>
  </header>
  <main>
    <div class="toolbar">
      <button type="button" id="refresh">Refresh</button>
      <span class="hint" id="status"></span>
    </div>
    <div id="root"></div>
  </main>
  <script>
    const root = document.getElementById("root");
    const statusEl = document.getElementById("status");
    function fmtMoney(minor, currency) {
      var n = (Number(minor) / 100).toFixed(2);
      return n + " " + (currency || "");
    }
    function render(orders) {
      if (!orders.length) {
        root.innerHTML = '<div class="empty">No placed orders yet. Complete a checkout with Vipps to see rows here.</div>';
        return;
      }
      root.innerHTML = orders.map(function (o) {
        var ord = o.order;
        var mf = o.merchant_fulfillment;
        var shipped = !!mf;
        var lines = (o.line_items || []).map(function (li) {
          var title = li.item && li.item.title ? li.item.title : li.id;
          var unit = li.item && li.item.price != null ? fmtMoney(li.item.price, o.currency) : "—";
          return "<tr><td>" + escapeHtml(title) + "</td><td>" + li.quantity + "</td><td>" + unit + "</td></tr>";
        }).join("");
        var totalRows = (o.totals || []).map(function (t) {
          return "<tr class='totals'><td colspan='2'>" + escapeHtml(t.type) + "</td><td>" + fmtMoney(t.amount, o.currency) + "</td></tr>";
        }).join("");
        var shipAddr = o.shipping_address;
        var addrBlock = shipAddr
          ? "<div class='meta'><strong>Ship to</strong> " + escapeHtml(shipAddr.name || "") + ", "
            + escapeHtml(shipAddr.line_one || "") + ", " + escapeHtml(shipAddr.postal_code || "") + " "
            + escapeHtml(shipAddr.city || "") + "</div>"
          : "";
        var buyer = o.buyer && o.buyer.name ? "<div class='meta'><strong>Buyer</strong> " + escapeHtml(o.buyer.name) + "</div>" : "";
        var webhookHint = o.platform_webhook_configured
          ? ""
          : "<p class='hint'>No platform order webhook was stored for this session (checkout without UCP-Agent <code>dev.ucp.shopping.order</code>).</p>";
        var fulfillBlock = shipped
          ? "<div class='meta'>Notified at " + escapeHtml(mf.notified_at) + " · <a href='" + escapeAttr(mf.tracking_url) + "' target='_blank' rel='noopener'>" + escapeHtml(mf.carrier) + " · " + escapeHtml(mf.tracking_number) + "</a> · event <code>" + escapeHtml(mf.event_id) + "</code></div>"
          : "";
        return (
          "<section class='card'><h2>" +
          "<span class='badge " + (shipped ? "shipped" : "pending") + "'>" + (shipped ? "Shipped" : "Pending fulfillment") + "</span>" +
          "<span>Order <code>" + escapeHtml(ord.id) + "</code></span></h2>" +
          "<div class='meta'>Checkout <code>" + escapeHtml(o.checkout_id) + "</code> · Session <code>" + escapeHtml(o.session_status) + "</code> · Ref <code>" + escapeHtml(ord.reference) + "</code></div>" +
          buyer + addrBlock +
          "<table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th></tr></thead><tbody>" + lines + totalRows + "</tbody></table>" +
          fulfillBlock + webhookHint +
          "<div class='actions'>" +
          (shipped
            ? "<span class='hint'>Platform webhook already notified.</span>"
            : "<button type='button' class='primary ship-btn' data-order-id='" + escapeAttr(ord.id) + "' data-checkout-id='" + escapeAttr(o.checkout_id) + "'" + (o.platform_webhook_configured ? "" : " disabled") + ">Mark as shipped</button>") +
          "</div></section>"
        );
      }).join("");
      root.querySelectorAll(".ship-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          markShipped(btn.getAttribute("data-order-id"), btn.getAttribute("data-checkout-id"), btn);
        });
      });
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
      });
    }
    function escapeAttr(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/'/g, "&#39;")
        .replace(/"/g, "&quot;");
    }
    async function markShipped(orderId, checkoutId, btn) {
      btn.disabled = true;
      statusEl.textContent = "Calling shipping callback…";
      try {
        var res = await fetch("/api/shipping/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: orderId,
            checkout_id: checkoutId,
            status: "shipped",
          }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          statusEl.textContent = "Error " + res.status + ": " + (data.error || data.message || res.statusText);
          btn.disabled = false;
          return;
        }
        if (!data.success) {
          statusEl.textContent = "Platform rejected webhook (HTTP " + (data.webhook && data.webhook.status) + "): " + String(data.platform_response || "").slice(0, 200);
          btn.disabled = false;
          return;
        }
        statusEl.textContent = "Webhook accepted. Refreshing…";
        await load();
        statusEl.textContent = "";
      } catch (e) {
        statusEl.textContent = String(e.message || e);
        btn.disabled = false;
      }
    }
    async function load() {
      statusEl.textContent = "Loading…";
      try {
        var res = await fetch("/api/demo/orders");
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        render(data.orders || []);
        statusEl.textContent = "";
      } catch (e) {
        root.innerHTML = "<div class='error'>Failed to load orders: " + escapeHtml(String(e.message || e)) + "</div>";
        statusEl.textContent = "";
      }
    }
    document.getElementById("refresh").addEventListener("click", load);
    load();
  <\/script>
</body>
</html>`;

export function handleOrdersDashboard(): Response {
  return new Response(DASHBOARD_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
