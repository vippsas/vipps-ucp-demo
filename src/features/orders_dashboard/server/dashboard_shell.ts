const DASHBOARD_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Orders — UCP demo merchant</title>
  <link rel="stylesheet" href="/static/orders-dashboard.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/static/orders-dashboard.js"></script>
</body>
</html>`;

export function handleOrdersDashboard(): Response {
  return new Response(DASHBOARD_SHELL, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
