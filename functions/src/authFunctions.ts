import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as crypto from "crypto";
import { google } from "googleapis";
import { admin, db } from "./firebase";

function getSecretsStrict() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSec = process.env.GOOGLE_CLIENT_SECRET || "";
  const baseUrl = process.env.OAUTH_BASE_URL || `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net`;

  const keyB = process.env.CRYPTO_KEY_BASE64 ? Buffer.from(process.env.CRYPTO_KEY_BASE64, "base64") : null;
  const ivB = process.env.CRYPTO_IV_BASE64 ? Buffer.from(process.env.CRYPTO_IV_BASE64, "base64") : null;

  return { clientId, clientSec, baseUrl, keyB, ivB };
}

function makeCrypto(keyB: Buffer, ivB: Buffer) {
  return {
    enc(s: string) {
      const cipher = crypto.createCipheriv("aes-256-cbc", keyB, ivB);
      let out = cipher.update(s, "utf8", "base64");
      out += cipher.final("base64");
      return out;
    },
    dec(b64: string) {
      const decipher = crypto.createDecipheriv("aes-256-cbc", keyB, ivB);
      let out = decipher.update(b64, "base64", "utf8");
      out += decipher.final("utf8");
      return out;
    },
  };
}

export const googleOAuthStart = onRequest({ region: "us-central1", invoker: "public" }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  try {
    const { clientId, clientSec, baseUrl, keyB, ivB } = getSecretsStrict();
    if (!clientId || !clientSec) { res.status(500).send("OAuth not configured"); return; }
    if (!keyB || !ivB) { res.status(500).send("Crypto not configured"); return; }

    const { enc } = makeCrypto(keyB, ivB);
    const oauth2 = new google.auth.OAuth2(clientId, clientSec, `${baseUrl}/googleOAuthCallback`);
    const { idToken, redirect } = req.query as { idToken?: string; redirect?: string };
    if (!idToken) { res.status(400).send("Missing idToken"); return; }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const state = enc(JSON.stringify({ uid: decoded.uid, redirect: redirect || "/" }));

    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar"],
      state,
    });

    res.redirect(url);
  } catch (e) {
    logger.error("googleOAuthStart failed", e);
    res.status(500).send("Failed to start Google OAuth");
  }
});

export const googleOAuthCallback = onRequest({ region: "us-central1", invoker: "public" }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  try {
    const { clientId, clientSec, baseUrl, keyB, ivB } = getSecretsStrict();
    if (!clientId || !clientSec) { res.status(500).send("OAuth not configured"); return; }
    if (!keyB || !ivB) { res.status(500).send("Crypto not configured"); return; }

    const { dec, enc } = makeCrypto(keyB, ivB);
    const oauth2 = new google.auth.OAuth2(clientId, clientSec, `${baseUrl}/googleOAuthCallback`);
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) { res.status(400).send("Missing code/state"); return; }

    const parsed = JSON.parse(dec(String(state))) as { uid: string; redirect: string };
    const { tokens } = await oauth2.getToken(String(code));

    await db.collection("users").doc(parsed.uid).collection("connections").doc("google").set({
      provider: "google",
      access_token_enc: tokens.access_token ? enc(tokens.access_token) : null,
      refresh_token_enc: tokens.refresh_token ? enc(tokens.refresh_token) : null,
      expiry_date: tokens.expiry_date || null,
      scope: tokens.scope || "https://www.googleapis.com/auth/calendar",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await db.collection("users").doc(parsed.uid).set({
      hasConnectedCalendar: true,
      connectionsSetupAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.redirect(parsed.redirect || "/");
  } catch (e) {
    logger.error("googleOAuthCallback failed", e);
    res.status(500).send("OAuth callback failed");
  }
});

export const healthCheck = onRequest((req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }

  res.status(200).send("✅ Smart Incubation Functions are running!");
});
