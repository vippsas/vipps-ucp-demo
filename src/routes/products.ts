import type { Product, ProductsStore } from "../types/merchant.ts";

const DATA_FILE = new URL("../data/products.json", import.meta.url);

async function loadProducts(): Promise<ProductsStore> {
  try {
    const data = await Deno.readTextFile(DATA_FILE);
    const store: ProductsStore = JSON.parse(data);
    console.log(
      `[PRODUCTS] Loaded ${store.products.length} products from ${DATA_FILE.pathname}`,
    );
    return store;
  } catch (error) {
    console.error(
      `[PRODUCTS] Failed to load products from ${DATA_FILE.pathname}:`,
      error,
    );
    return { products: [] };
  }
}

async function saveProducts(store: ProductsStore): Promise<void> {
  await Deno.writeTextFile(DATA_FILE, JSON.stringify(store, null, 2));
}

export async function handleGetProducts(_req: Request): Promise<Response> {
  const products = await loadProducts();

  return new Response(JSON.stringify({ products }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleGetProduct(
  _req: Request,
  sku: string,
): Promise<Response> {
  const products = await loadProducts();
  const product = products.products.find((p) => p.sku === sku);
  if (!product) {
    return new Response(JSON.stringify({ error: "Product not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(product), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Helper to update stock (used by checkout)
export async function updateStock(
  sku: string,
  quantityChange: number,
): Promise<boolean> {
  const products = await loadProducts();
  const productIndex = products.products.findIndex((p) => p.sku === sku);

  if (productIndex === -1) {
    return false;
  }

  const newStock = products.products[productIndex].stock + quantityChange;
  if (newStock < 0) {
    return false;
  }

  products.products[productIndex].stock = newStock;
  await saveProducts(products);
  return true;
}

// Helper to get product by SKU
export async function getProductBySku(sku: string): Promise<Product | null> {
  const products = await loadProducts();
  return products.products.find((p) => p.sku === sku) ?? null;
}
