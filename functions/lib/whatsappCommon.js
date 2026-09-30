"use strict";
// Small helpers shared by the Lepharo WhatsApp gateway and its staff module.
Object.defineProperty(exports, "__esModule", { value: true });
exports.timestampToIso = exports.candidatePhoneValues = exports.clean = exports.normalizePhone = void 0;
const normalizePhone = (value) => String(value || "").replace(/[^0-9]/g, "");
exports.normalizePhone = normalizePhone;
const clean = (value) => String(value || "").trim();
exports.clean = clean;
const candidatePhoneValues = (digits) => {
    const values = new Set();
    if (!digits)
        return [];
    values.add(digits);
    values.add(`+${digits}`);
    if (digits.startsWith("27") && digits.length >= 11) {
        values.add(`0${digits.slice(2)}`);
    }
    if (digits.startsWith("263") && digits.length >= 12) {
        values.add(`0${digits.slice(3)}`);
    }
    return Array.from(values);
};
exports.candidatePhoneValues = candidatePhoneValues;
const timestampToIso = (value) => {
    try {
        if (value?.toDate && typeof value.toDate === "function")
            return value.toDate().toISOString();
        if (value instanceof Date)
            return value.toISOString();
        if (typeof value === "string")
            return value || null;
        return null;
    }
    catch {
        return null;
    }
};
exports.timestampToIso = timestampToIso;
//# sourceMappingURL=whatsappCommon.js.map