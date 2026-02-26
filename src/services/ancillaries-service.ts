/**
 * Ancillaries Service
 *
 * Handles ancillary suggestions, automatic ancillaries, and processing
 * ancillary requests for checkout sessions.
 */

import type { Product } from "../types/merchant.ts";
import type {
  CheckoutSession,
  Item,
  LineItemResponse,
  TotalEntry,
} from "../types/ucp/checkout.ts";
import type {
  AncillariesResponse,
  AncillaryCategory,
  AncillaryItem,
  AncillaryRequestItem,
  AncillarySuggestion,
  AncillarySuggestionType,
  AppliedAncillary,
} from "../types/ucp/ancillaries.ts";
import { getProductBySku } from "../routes/products.ts";

// ============================================
// Helper Functions
// ============================================

/**
 * Map product type to ancillary category.
 */
function productTypeToCategory(productType: string): AncillaryCategory {
  switch (productType) {
    case "service":
      return "service";
    case "insurance":
      return "insurance";
    default:
      return "product";
  }
}

/**
 * Map relationship type to suggestion type.
 */
function relationshipTypeToSuggestionType(
  relType: string,
): AncillarySuggestionType {
  switch (relType) {
    case "required":
      return "required";
    case "complementary":
      return "complementary";
    default:
      return "suggested";
  }
}

/**
 * Convert a Product to an AncillaryItem.
 */
function productToAncillaryItem(product: Product): AncillaryItem {
  return {
    id: product.sku,
    title: product.name,
    price: product.price,
    description: product.description,
    image_url: product.image_url,
  };
}

/**
 * Convert a Product to a LineItem Item.
 */
function productToItem(product: Product): Item {
  return {
    id: product.sku,
    title: product.name,
    price: product.price,
    description: product.description,
    image_url: product.image_url,
  };
}

/**
 * Calculate totals for an item (VAT-exclusive, consistent with checkout.ts).
 */
function calculateItemTotals(price: number, quantity: number): TotalEntry[] {
  const subtotal = price * quantity;
  // Note: Line item totals don't include tax - tax is calculated at session level
  // This matches how checkout.ts handles line items
  return [
    { type: "subtotal", amount: subtotal },
    { type: "total", amount: subtotal },
  ];
}

/**
 * Generate a unique line item ID.
 */
function generateLineItemId(): string {
  return `li_${crypto.randomUUID().slice(0, 8)}`;
}

// ============================================
// Suggestion Building
// ============================================

/**
 * Build ancillary suggestions for a checkout session based on product relationships.
 */
export async function buildAncillarySuggestions(
  lineItems: LineItemResponse[],
  appliedAncillaries: AppliedAncillary[],
): Promise<AncillarySuggestion[]> {
  const suggestions: AncillarySuggestion[] = [];
  const seenSkus = new Set<string>();

  // Demo: Fetch upsell products for suggestions
  const insuranceProduct = await getProductBySku("DEMO-007");
  const headphoneCaseProduct = await getProductBySku("DEMO-009");

  const hasInsurance = lineItems.some((a) =>
    a.item.id === insuranceProduct?.sku
  );
  const hasHeadphoneCase = lineItems.some((a) =>
    a.item.id === headphoneCaseProduct?.sku
  );

  for (const lineItem of lineItems) {
    const product = await getProductBySku(lineItem.item.id);

    // Demo: Suggest headphone case when buying headphones (DEMO-001)
    if (
      lineItem.item.id === "DEMO-001" && headphoneCaseProduct &&
      !hasHeadphoneCase
    ) {
      if (!seenSkus.has(headphoneCaseProduct.sku)) {
        seenSkus.add(headphoneCaseProduct.sku);
        suggestions.push({
          item: productToAncillaryItem(headphoneCaseProduct),
          type: "complementary",
          category: "product",
          for: lineItem.id,
          description: headphoneCaseProduct.description,
        });
      }
    }

    if (product === null) {
      // TEMP: Auto apply insurance for demo purposes
      if (insuranceProduct && !hasInsurance) {
        if (!seenSkus.has(insuranceProduct.sku)) {
          seenSkus.add(insuranceProduct.sku);
          suggestions.push({
            item: productToAncillaryItem(insuranceProduct),
            type: "suggested",
            category: "service",
            for: lineItem.id,
            description: insuranceProduct.description,
          });
        }
      }
      continue;
    }

    if (!product.relationships) continue;

    for (const relationship of product.relationships) {
      // Skip if already applied or already suggested
      if (
        appliedAncillaries.some((a) =>
          a.for == lineItem.id && a.id === relationship.sku
        )
      ) continue;
      if (seenSkus.has(relationship.sku)) continue;

      const relatedProduct = await getProductBySku(relationship.sku);
      if (!relatedProduct) continue;

      seenSkus.add(relationship.sku);

      suggestions.push({
        item: productToAncillaryItem(relatedProduct),
        type: relationshipTypeToSuggestionType(relationship.type),
        category: productTypeToCategory(relatedProduct.type),
        for: lineItem.id,
        description: relatedProduct.description,
      });
    }
  }

  return suggestions;
}

// ============================================
// Automatic Ancillaries
// ============================================

/**
 * Find and apply required ancillaries automatically.
 * Returns new line items and applied ancillary records.
 */
export async function applyRequiredAncillaries(
  lineItems: LineItemResponse[],
  existingApplied: AppliedAncillary[],
): Promise<{
  newLineItems: LineItemResponse[];
  newApplied: AppliedAncillary[];
}> {
  const newLineItems: LineItemResponse[] = [];
  const newApplied: AppliedAncillary[] = [];
  const appliedSkus = new Set(
    existingApplied.map((a) => lineItems.find((li) => li.id === a.id)?.item.id)
      .filter(Boolean) as string[],
  );

  for (const lineItem of lineItems) {
    const product = await getProductBySku(lineItem.item.id);
    if (!product?.relationships) continue;

    const requiredRelationships = product.relationships.filter(
      (r) => r.type === "required",
    );

    for (const relationship of requiredRelationships) {
      // Skip if already applied
      if (appliedSkus.has(relationship.sku)) continue;

      const relatedProduct = await getProductBySku(relationship.sku);
      if (!relatedProduct) continue;

      appliedSkus.add(relationship.sku);

      const newLineItemId = generateLineItemId();

      // Create line item for the required ancillary
      newLineItems.push({
        id: newLineItemId,
        item: productToItem(relatedProduct),
        quantity: lineItem.quantity,
        totals: calculateItemTotals(relatedProduct.price, lineItem.quantity),
      });

      // Create applied ancillary record
      newApplied.push({
        id: newLineItemId,
        for: lineItem.id,
        type: "required",
        category: productTypeToCategory(relatedProduct.type),
        description: `${relatedProduct.name} (required)`,
        automatic: true,
        reason_code: "legal_requirement",
      });
    }
  }

  return { newLineItems, newApplied };
}

// ============================================
// Processing Ancillary Requests
// ============================================

/**
 * Process ancillary request items and create line items.
 * Returns new line items and applied ancillary records.
 */
export async function processAncillaryRequest(
  requestItems: AncillaryRequestItem[],
  existingLineItems: LineItemResponse[],
  existingApplied: AppliedAncillary[],
): Promise<{
  newLineItems: LineItemResponse[];
  newApplied: AppliedAncillary[];
  errors: string[];
}> {
  const newLineItems: LineItemResponse[] = [];
  const newApplied: AppliedAncillary[] = [];
  const errors: string[] = [];

  // Get SKUs of already applied ancillaries
  const appliedSkus = new Set(
    existingApplied.map((a) =>
      existingLineItems.find((li) => li.id === a.id)?.item.id
    ).filter(Boolean) as string[],
  );

  for (const requestItem of requestItems) {
    const sku = requestItem.item.id;

    // Skip if already applied
    if (appliedSkus.has(sku)) {
      errors.push(`Ancillary ${sku} is already applied`);
      continue;
    }

    const product = await getProductBySku(sku);
    if (!product) {
      errors.push(`Product ${sku} not found`);
      continue;
    }

    // Validate quantity matches related line item if specified
    if (requestItem.for) {
      const relatedLineItem = existingLineItems.find(
        (li) => li.id === requestItem.for,
      );
      if (!relatedLineItem) {
        errors.push(`Related line item ${requestItem.for} not found`);
        continue;
      }
      if (requestItem.quantity !== relatedLineItem.quantity) {
        errors.push(
          `Ancillary quantity must match related line item quantity`,
        );
        continue;
      }
    }

    appliedSkus.add(sku);

    const newLineItemId = generateLineItemId();

    // Create line item
    newLineItems.push({
      id: newLineItemId,
      item: productToItem(product),
      quantity: requestItem.quantity,
      totals: calculateItemTotals(product.price, requestItem.quantity),
    });

    // Create applied ancillary record
    // Try to find the suggestion type from existing suggestions
    let suggestionType: AncillarySuggestionType = "suggested";
    if (requestItem.for) {
      const relatedLineItem = existingLineItems.find(
        (li) => li.id === requestItem.for,
      );
      if (relatedLineItem) {
        const parentProduct = await getProductBySku(relatedLineItem.item.id);
        const relationship = parentProduct?.relationships?.find(
          (r) => r.sku === sku,
        );
        if (relationship) {
          suggestionType = relationshipTypeToSuggestionType(relationship.type);
        }
      }
    }

    newApplied.push({
      id: newLineItemId,
      for: requestItem.for,
      type: suggestionType,
      category: productTypeToCategory(product.type),
      description: product.name,
      input: requestItem.input,
    });
  }

  return { newLineItems, newApplied, errors };
}

// ============================================
// Main Integration Functions
// ============================================

/**
 * Build the complete ancillaries object for a checkout session.
 * Includes suggestions and applied ancillaries.
 */
export async function buildAncillariesResponse(
  lineItems: LineItemResponse[],
  appliedAncillaries: AppliedAncillary[],
): Promise<AncillariesResponse> {
  const suggested = await buildAncillarySuggestions(
    lineItems,
    appliedAncillaries,
  );

  const result: AncillariesResponse = {};

  if (suggested.length > 0) {
    result.title = "Recommended additions";
    result.suggested = suggested;
  }

  if (appliedAncillaries.length > 0) {
    result.applied = appliedAncillaries;
  }

  return result;
}

/**
 * Initialize ancillaries for a new checkout session.
 * Applies required ancillaries automatically and builds suggestions.
 */
export async function initializeAncillaries(
  lineItems: LineItemResponse[],
): Promise<{
  updatedLineItems: LineItemResponse[];
  ancillaries: AncillariesResponse;
}> {
  // Apply required ancillaries automatically
  const { newLineItems, newApplied } = await applyRequiredAncillaries(
    lineItems,
    [],
  );

  const updatedLineItems = [...lineItems, ...newLineItems];

  // Build the ancillaries object
  const ancillaries = await buildAncillariesResponse(
    updatedLineItems,
    newApplied,
  );

  return { updatedLineItems, ancillaries };
}

/**
 * Update ancillaries for an existing checkout session.
 * Processes ancillary requests and rebuilds suggestions.
 */
export async function updateAncillaries(
  session: CheckoutSession,
  requestItems: AncillaryRequestItem[] | undefined,
): Promise<{
  updatedLineItems: LineItemResponse[];
  ancillaries: AncillariesResponse;
  errors: string[];
}> {
  let lineItems = [...session.line_items];
  let appliedAncillaries = session.ancillaries?.applied ?? [];
  const errors: string[] = [];

  // If request items provided, process them
  // Note: Per spec, submitting items replaces previously submitted (non-automatic) ancillaries
  if (requestItems !== undefined) {
    // Remove previously applied non-automatic ancillaries
    const automaticApplied = appliedAncillaries.filter((a) => a.automatic);
    const automaticLineItemIds = new Set(automaticApplied.map((a) => a.id));

    // Keep only line items that are not non-automatic ancillaries
    const nonAncillaryLineItems = lineItems.filter((li) => {
      const isApplied = appliedAncillaries.some((a) => a.id === li.id);
      const isAutomatic = automaticLineItemIds.has(li.id);
      return !isApplied || isAutomatic;
    });

    lineItems = nonAncillaryLineItems;
    appliedAncillaries = automaticApplied;

    // Process new ancillary requests
    if (requestItems.length > 0) {
      const result = await processAncillaryRequest(
        requestItems,
        lineItems,
        appliedAncillaries,
      );

      lineItems = [...lineItems, ...result.newLineItems];
      appliedAncillaries = [...appliedAncillaries, ...result.newApplied];
      errors.push(...result.errors);
    }
  }

  // Build the ancillaries object
  const ancillaries = await buildAncillariesResponse(
    lineItems,
    appliedAncillaries,
  );

  return { updatedLineItems: lineItems, ancillaries, errors };
}
