export const APP_BASE_URL = process.env.APP_BASE_URL || "https://lepharosmartinc.co.za";

export const ALLOW_ORIGINS = new Set([
  "http://localhost:5173",
  "https://lepharosmartinc.co.za",
  "https://www.lepharosmartinc.co.za",
  "https://oauth.lepharosmartinc.co.za",
]);

export const DEFAULT_PASSWORD = "Password@1";

/**
 * Route a function's outbound traffic through the `functions-egress` VPC
 * connector and Cloud NAT so it leaves from one static IPv4, 34.122.36.41
 * (reserved as `brevo-egress-ip`, us-central1). Brevo's IP security rejects
 * the rotating Google addresses Cloud Functions use by default, so every
 * function that calls the Brevo API spreads this into its options, and that
 * IP is the one authorised in Brevo (Settings -> Security -> Authorised IPs).
 * ALL_TRAFFIC is required: the Brevo API is a public endpoint, and only
 * private ranges go through the connector otherwise.
 */
export const BREVO_EGRESS = {
  vpcConnector: "functions-egress",
  vpcConnectorEgressSettings: "ALL_TRAFFIC",
} as const;
