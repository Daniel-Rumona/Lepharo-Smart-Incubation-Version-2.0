import * as crypto from "crypto";

export function getSecretsStrict() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSec = process.env.GOOGLE_CLIENT_SECRET || "";
  const baseUrl =
    process.env.OAUTH_BASE_URL ||
    `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net`;

  const keyB = process.env.CRYPTO_KEY_BASE64
    ? Buffer.from(process.env.CRYPTO_KEY_BASE64, "base64")
    : null;
  const ivB = process.env.CRYPTO_IV_BASE64
    ? Buffer.from(process.env.CRYPTO_IV_BASE64, "base64")
    : null;

  return { clientId, clientSec, baseUrl, keyB, ivB };
}

export function makeCrypto(keyB: Buffer, ivB: Buffer) {
  return {
    enc(s: string) {
      const c = crypto.createCipheriv("aes-256-cbc", keyB, ivB);
      let out = c.update(s, "utf8", "base64");
      out += c.final("base64");
      return out;
    },
    dec(b64: string) {
      const d = crypto.createDecipheriv("aes-256-cbc", keyB, ivB);
      let out = d.update(b64, "base64", "utf8");
      out += d.final("utf8");
      return out;
    },
  };
}

export function mkSig(seed: string) {
  const nonce = crypto.randomBytes(8).toString("hex");
  return crypto
    .createHash("sha256")
    .update(`${seed}|${Date.now()}|${nonce}`)
    .digest("hex");
}
