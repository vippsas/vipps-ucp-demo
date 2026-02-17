// Demo merchant types

import type { CheckoutSession } from "./ucp/checkout.ts";

// Product catalog types
export interface Product {
  sku: string;
  name: string;
  description: string;
  price: number; // minor units (cents/øre)
  currency: string;
  stock: number;
  image_url?: string;
}

// Data store types
export interface ProductsStore {
  products: Product[];
}

export interface SessionsStore {
  sessions: CheckoutSession[];
}
