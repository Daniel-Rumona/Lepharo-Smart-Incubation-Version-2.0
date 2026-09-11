import { ALLOW_ORIGINS } from "../config";

export function setCors(req: any, res: any) {
  const origin = req.headers.origin;
  if (origin && ALLOW_ORIGINS.has(origin)) res.set("Access-Control-Allow-Origin", origin);
  else res.set("Access-Control-Allow-Origin", "https://lepharosmartinc.co.za");
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
