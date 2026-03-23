import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OrdersDashboardApp } from "./OrdersDashboardApp.tsx";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <OrdersDashboardApp />
    </StrictMode>,
  );
}
