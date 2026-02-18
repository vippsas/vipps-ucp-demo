import type { ErrorResponse } from "../types/ucp/checkout.ts";
import type { Product } from "../types/merchant.ts";
import { products } from "../data/products.ts";

export function handleGetProducts(_req: Request): Response {
  return new Response(JSON.stringify({ products }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function handleGetProduct(
  _req: Request,
  sku: string,
): Response {
  const product = products.find((p) => p.sku === sku);

  if (!product) {
    const error: ErrorResponse = {
      error: {
        type: "not_found",
        code: "product_not_found",
        message: `Product with SKU '${sku}' not found`,
        param: "sku",
      },
    };
    return new Response(JSON.stringify(error), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(product), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function updateStock(
  sku: string,
  quantityChange: number,
): boolean {
  const productIndex = products.findIndex((p) => p.sku === sku);

  if (productIndex === -1) {
    return false;
  }

  const newStock = products[productIndex].stock + quantityChange;
  if (newStock < 0) {
    return false;
  }

  products[productIndex].stock = newStock;
  return true;
}

export function getProductBySku(sku: string): Product | null {
  return products.find((p) => p.sku === sku) ?? null;
}
