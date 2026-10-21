export interface VippsConfig {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
  msn: string;
}

let config: VippsConfig | null = null;

export function loadConfig(): void {
  config = {
    apiBaseUrl: process.env.VIPPS_API_BASE_URL ?? "",
    clientId: process.env.VIPPS_CLIENT_ID ?? "",
    clientSecret: process.env.VIPPS_CLIENT_SECRET ?? "",
    subscriptionKey: process.env.VIPPS_SUBSCRIPTION_KEY ?? "",
    msn: process.env.VIPPS_MERCHANT_SERIAL_NUMBER ?? "",
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
    console.error("Missing or empty required env: " + missing.join(", "));
    process.exit(1);
  }
}

export function getConfig(): VippsConfig {
  if (!config) throw new Error("Call loadConfig() before getConfig()");
  return config;
}
