"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toDate = exports.fmtDate = void 0;
const fmtDate = (d) => d.toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
});
exports.fmtDate = fmtDate;
function toDate(v) {
    try {
        if (v?.toDate && typeof v.toDate === "function")
            return v.toDate();
        if (v instanceof Date)
            return v;
        return null;
    }
    catch {
        return null;
    }
}
exports.toDate = toDate;
//# sourceMappingURL=dates.js.map