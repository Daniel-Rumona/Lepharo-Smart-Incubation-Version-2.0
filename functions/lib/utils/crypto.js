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
exports.mkSig = exports.makeCrypto = exports.getSecretsStrict = void 0;
const crypto = __importStar(require("crypto"));
function getSecretsStrict() {
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    const clientSec = process.env.GOOGLE_CLIENT_SECRET || "";
    const baseUrl = process.env.OAUTH_BASE_URL ||
        `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net`;
    const keyB = process.env.CRYPTO_KEY_BASE64
        ? Buffer.from(process.env.CRYPTO_KEY_BASE64, "base64")
        : null;
    const ivB = process.env.CRYPTO_IV_BASE64
        ? Buffer.from(process.env.CRYPTO_IV_BASE64, "base64")
        : null;
    return { clientId, clientSec, baseUrl, keyB, ivB };
}
exports.getSecretsStrict = getSecretsStrict;
function makeCrypto(keyB, ivB) {
    return {
        enc(s) {
            const c = crypto.createCipheriv("aes-256-cbc", keyB, ivB);
            let out = c.update(s, "utf8", "base64");
            out += c.final("base64");
            return out;
        },
        dec(b64) {
            const d = crypto.createDecipheriv("aes-256-cbc", keyB, ivB);
            let out = d.update(b64, "base64", "utf8");
            out += d.final("utf8");
            return out;
        },
    };
}
exports.makeCrypto = makeCrypto;
function mkSig(seed) {
    const nonce = crypto.randomBytes(8).toString("hex");
    return crypto
        .createHash("sha256")
        .update(`${seed}|${Date.now()}|${nonce}`)
        .digest("hex");
}
exports.mkSig = mkSig;
//# sourceMappingURL=crypto.js.map