import { load } from "@std/dotenv";
import { Logger } from "@deno-library/logger";

const logger = new Logger();

export interface VippsConfig {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
  msn: string;
}

let config: VippsConfig | null = null;

export async function loadConfig(): Promise<void> {
  try {
    await load({ export: true });
  } catch {
    // .env file is optional
  }

  config = {
    apiBaseUrl: Deno.env.get("VIPPS_API_BASE_URL") ?? "",
    clientId: Deno.env.get("VIPPS_CLIENT_ID") ?? "",
    clientSecret: Deno.env.get("VIPPS_CLIENT_SECRET") ?? "",
    subscriptionKey: Deno.env.get("VIPPS_SUBSCRIPTION_KEY") ?? "",
    msn: Deno.env.get("VIPPS_MERCHANT_SERIAL_NUMBER") ?? "",
  };

  const required: (keyof VippsConfig)[] = [
    "apiBaseUrl",
    "clientId",
    "clientSecret",
    "subscriptionKey",
    "msn",
  ];
  const missing = required.filter((key) => !config![key]?.trim());
  if (missing.length > 0) {
    logger.error("Missing or empty required env: " + missing.join(", "));
    Deno.exit(1);
  }
}

export function getConfig(): VippsConfig {
  if (!config) throw new Error("Call loadConfig() before getConfig()");
  return config;
}
