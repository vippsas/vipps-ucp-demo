import type {
  FulfillmentAvailableMethodResponse,
  FulfillmentMethodResponse,
  FulfillmentOptionResponse,
  PostalAddress,
  RetailLocationResponse,
  ShippingDestinationResponse,
  TotalEntry,
} from "../types.ts";

const DATA_FILE = new URL("../data/fulfillment-options.json", import.meta.url);

type ShippingOptionJson = {
  id: string;
  title: string;
  description: string;
  carrier: string;
  delivery_days_min?: number;
  delivery_days_max?: number;
  same_day_hours?: { start: number; end: number };
  totals: TotalEntry[];
};

type PickupOptionJson = {
  id: string;
  title: string;
  description: string;
  hours_until_ready: number;
  totals: TotalEntry[];
};

type StoreLocationJson = {
  id: string;
  name: string;
  address: PostalAddress;
};

type FulfillmentOptionsStore = {
  shipping_options: ShippingOptionJson[];
  pickup_options: PickupOptionJson[];
  store_locations: StoreLocationJson[];
  default_shipping_destination: ShippingDestinationResponse;
};

let cachedOptions: FulfillmentOptionsStore | null = null;

async function loadFulfillmentOptions(): Promise<FulfillmentOptionsStore> {
  if (cachedOptions) return cachedOptions;
  const data = await Deno.readTextFile(DATA_FILE);
  cachedOptions = JSON.parse(data);
  return cachedOptions!;
}

const toISO = (d: Date): string => d.toISOString();
const futureDate = (days: number, hour = 18): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return toISO(d);
};
const hoursFromNow = (hours: number): string => {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return toISO(d);
};

function transformShippingOption(
  opt: ShippingOptionJson,
): FulfillmentOptionResponse {
  const result: FulfillmentOptionResponse = {
    id: opt.id,
    title: opt.title,
    description: opt.description,
    carrier: opt.carrier,
    totals: opt.totals,
  };
  if (opt.same_day_hours) {
    result.earliest_fulfillment_time = futureDate(0, opt.same_day_hours.start);
    result.latest_fulfillment_time = futureDate(0, opt.same_day_hours.end);
  } else {
    if (opt.delivery_days_min !== undefined) {
      result.earliest_fulfillment_time = futureDate(opt.delivery_days_min);
    }
    if (opt.delivery_days_max !== undefined) {
      result.latest_fulfillment_time = futureDate(opt.delivery_days_max);
    }
  }
  return result;
}

function transformPickupOption(
  opt: PickupOptionJson,
): FulfillmentOptionResponse {
  return {
    id: opt.id,
    title: opt.title,
    description: opt.description,
    earliest_fulfillment_time: hoursFromNow(opt.hours_until_ready),
    totals: opt.totals,
  };
}

function transformStoreLocation(
  loc: StoreLocationJson,
): RetailLocationResponse {
  return { id: loc.id, name: loc.name, address: loc.address };
}

export async function buildFulfillmentMethods(
  lineItemIds: string[],
): Promise<FulfillmentMethodResponse[]> {
  const opts = await loadFulfillmentOptions();
  return [
    {
      id: "shipping_1",
      type: "shipping",
      line_item_ids: lineItemIds,
      selected_destination_id: opts.default_shipping_destination.id,
      destinations: [opts.default_shipping_destination],
      groups: [{
        id: "group_1",
        line_item_ids: lineItemIds,
        selected_option_id: "postnord_standard",
        options: opts.shipping_options.map(transformShippingOption),
      }],
    },
    {
      id: "pickup_1",
      type: "pickup",
      line_item_ids: lineItemIds,
      selected_destination_id: null,
      destinations: opts.store_locations.map(transformStoreLocation),
      groups: [{
        id: "pickup_group_1",
        line_item_ids: lineItemIds,
        selected_option_id: null,
        options: opts.pickup_options.map(transformPickupOption),
      }],
    },
  ];
}

export async function buildAvailableMethods(
  lineItemIds: string[],
): Promise<FulfillmentAvailableMethodResponse[]> {
  const opts = await loadFulfillmentOptions();
  const firstStore = opts.store_locations[0];
  return [
    { type: "shipping", line_item_ids: lineItemIds, fulfillable_on: "now" },
    {
      type: "pickup",
      line_item_ids: lineItemIds,
      fulfillable_on: "now",
      description: firstStore
        ? `Tilgjengelig for henting hos ${firstStore.name}`
        : undefined,
    },
  ];
}

export function getSelectedFulfillmentCost(
  methods: FulfillmentMethodResponse[],
): number {
  for (const method of methods) {
    if (!method.groups) continue;
    for (const group of method.groups) {
      if (group.selected_option_id && group.options) {
        const option = group.options.find((o) =>
          o.id === group.selected_option_id
        );
        if (option) {
          const total = option.totals.find((t) => t.type === "total");
          return total?.amount ?? 0;
        }
      }
    }
  }
  return 0;
}
