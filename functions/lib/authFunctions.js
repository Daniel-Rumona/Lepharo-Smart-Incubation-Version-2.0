"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCheck = exports.googleOAuthCallback = exports.googleOAuthStart = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const crypto = __importStar(require("crypto"));
const googleapis_1 = require("googleapis");
const firebase_1 = require("./firebase");
function getSecretsStrict() {
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    const clientSec = process.env.GOOGLE_CLIENT_SECRET || "";
    const baseUrl = process.env.OAUTH_BASE_URL || `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net`;
    const keyB = process.env.CRYPTO_KEY_BASE64 ? Buffer.from(process.env.CRYPTO_KEY_BASE64, "base64") : null;
    const ivB = process.env.CRYPTO_IV_BASE64 ? Buffer.from(process.env.CRYPTO_IV_BASE64, "base64") : null;
    return { clientId, clientSec, baseUrl, keyB, ivB };
}
function makeCrypto(keyB, ivB) {
    return {
        enc(s) {
            const cipher = crypto.createCipheriv("aes-256-cbc", keyB, ivB);
            let out = cipher.update(s, "utf8", "base64");
            out += cipher.final("base64");
            return out;
        },
        dec(b64) {
            const decipher = crypto.createDecipheriv("aes-256-cbc", keyB, ivB);
            let out = decipher.update(b64, "base64", "utf8");
            out += decipher.final("utf8");
            return out;
        },
    };
}
exports.googleOAuthStart = (0, https_1.onRequest)({ region: "us-central1", invoker: "public" }, async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    try {
        const { clientId, clientSec, baseUrl, keyB, ivB } = getSecretsStrict();
        if (!clientId || !clientSec) {
            res.status(500).send("OAuth not configured");
            return;
        }
        if (!keyB || !ivB) {
            res.status(500).send("Crypto not configured");
            return;
        }
        const { enc } = makeCrypto(keyB, ivB);
        const oauth2 = new googleapis_1.google.auth.OAuth2(clientId, clientSec, `${baseUrl}/googleOAuthCallback`);
        const { idToken, redirect } = req.query;
        if (!idToken) {
            res.status(400).send("Missing idToken");
            return;
        }
        const decoded = await firebase_1.admin.auth().verifyIdToken(idToken);
        const state = enc(JSON.stringify({ uid: decoded.uid, redirect: redirect || "/" }));
        const url = oauth2.generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            scope: ["https://www.googleapis.com/auth/calendar"],
            state,
        });
        res.redirect(url);
    }
    catch (e) {
        logger.error("googleOAuthStart failed", e);
        res.status(500).send("Failed to start Google OAuth");
    }
});
exports.googleOAuthCallback = (0, https_1.onRequest)({ region: "us-central1", invoker: "public" }, async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    try {
        const { clientId, clientSec, baseUrl, keyB, ivB } = getSecretsStrict();
        if (!clientId || !clientSec) {
            res.status(500).send("OAuth not configured");
            return;
        }
        if (!keyB || !ivB) {
            res.status(500).send("Crypto not configured");
            return;
        }
        const { dec, enc } = makeCrypto(keyB, ivB);
        const oauth2 = new googleapis_1.google.auth.OAuth2(clientId, clientSec, `${baseUrl}/googleOAuthCallback`);
        const { code, state } = req.query;
        if (!code || !state) {
            res.status(400).send("Missing code/state");
            return;
        }
        const parsed = JSON.parse(dec(String(state)));
        const { tokens } = await oauth2.getToken(String(code));
        await firebase_1.db.collection("users").doc(parsed.uid).collection("connections").doc("google").set({
            provider: "google",
            access_token_enc: tokens.access_token ? enc(tokens.access_token) : null,
            refresh_token_enc: tokens.refresh_token ? enc(tokens.refresh_token) : null,
            expiry_date: tokens.expiry_date || null,
            scope: tokens.scope || "https://www.googleapis.com/auth/calendar",
            updatedAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
            createdAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await firebase_1.db.collection("users").doc(parsed.uid).set({
            hasConnectedCalendar: true,
            connectionsSetupAt: firebase_1.admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.redirect(parsed.redirect || "/");
    }
    catch (e) {
        logger.error("googleOAuthCallback failed", e);
        res.status(500).send("OAuth callback failed");
    }
});
exports.healthCheck = (0, https_1.onRequest)((req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    res.status(200).send("✅ Smart Incubation Functions are running!");
});
//# sourceMappingURL=authFunctions.js.map