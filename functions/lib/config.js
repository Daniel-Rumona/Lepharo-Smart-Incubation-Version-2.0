"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PASSWORD = exports.ALLOW_ORIGINS = exports.APP_BASE_URL = void 0;
exports.APP_BASE_URL = process.env.APP_BASE_URL || "https://lepharosmartinc.co.za";
exports.ALLOW_ORIGINS = new Set([
    "http://localhost:5173",
    "https://lepharosmartinc.co.za",
    "https://www.lepharosmartinc.co.za",
    "https://oauth.lepharosmartinc.co.za",
]);
exports.DEFAULT_PASSWORD = "Password@1";
//# sourceMappingURL=config.js.map