// Demo merchant types

import type { CheckoutSession } from "./ucp/checkout.ts";

export type ProductType = "product" | "service";

// Product catalog types
export interface Product {
  sku: string;
  name: string;
  description: string;
  price: number; // minor units (cents/øre)
  currency: string;
  image_url?: string;
  type: ProductType;
  stock: number;
  relationships?: ProductRelationship[];
}

export interface ProductRelationship {
  type: "suggested" | "required";
  sku: string;
}

// Data store types
export interface ProductsStore {
  products: Product[];
}

export interface SessionsStore {
  sessions: CheckoutSession[];
}
