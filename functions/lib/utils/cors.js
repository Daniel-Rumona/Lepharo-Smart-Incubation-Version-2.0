"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setCors = void 0;
const config_1 = require("../config");
function setCors(req, res) {
    const origin = req.headers.origin;
    if (origin && config_1.ALLOW_ORIGINS.has(origin))
        res.set("Access-Control-Allow-Origin", origin);
    else
        res.set("Access-Control-Allow-Origin", "https://lepharosmartinc.co.za");
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
exports.setCors = setCors;
//# sourceMappingURL=cors.js.map