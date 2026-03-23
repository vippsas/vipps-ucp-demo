import { useCallback, useEffect, useState } from "react";
import type { PlacedOrderSummary } from "../types.ts";

export function usePlacedOrders() {
  const [orders, setOrders] = useState<PlacedOrderSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/demo/orders");
      const data = (await res.json()) as {
        orders?: PlacedOrderSummary[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      setOrders(data.orders ?? []);
    } catch (e) {
      setLoadError(String((e as Error).message ?? e));
      setOrders(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { orders, loadError, loading, refresh };
}
