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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deckBuffer = exports.addAgenda = exports.addClosing = exports.addCover = exports.newDeck = exports.coverImage = exports.imageData = exports.headerCell = exports.chunk = exports.AREA = exports.FONT = exports.TEXT = exports.BLUE_LIGHT = exports.BLUE = exports.MAROON = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pptxgenjs_1 = __importDefault(require("pptxgenjs"));
const lib_1 = require("./lib");
/**
 * The Lepharo report template shared by every report deck: the three backgrounds in
 * assets/report-templates (the original centre slides with their text blanked out), the numbered red
 * circle, and the content area. Each report draws its own slides on top.
 */
exports.MAROON = "7B1416";
const CIRCLE = "791315";
exports.BLUE = "4472C4";
exports.BLUE_LIGHT = "DAE3F3";
exports.TEXT = "262626";
exports.FONT = "Calibri";
// Content area on the template, in inches (13.333 x 7.5 slide).
exports.AREA = { x: 0.6, y: 1.4, w: 12.1, h: 5.05 };
const TEMPLATE_DIR = path.join(__dirname, "..", "..", "assets", "report-templates");
const backgrounds = new Map();
const background = (name) => {
    if (!backgrounds.has(name)) {
        backgrounds.set(name, `image/jpeg;base64,${fs.readFileSync(path.join(TEMPLATE_DIR, `${name}.jpg`)).toString("base64")}`);
    }
    return { data: backgrounds.get(name) };
};
const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
exports.chunk = chunk;
const headerCell = (text, fill = exports.BLUE) => ({ text, options: { bold: true, color: "FFFFFF", fill: { color: fill } } });
exports.headerCell = headerCell;
const IMAGE_TYPES = { "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg", "image/png": "image/png", "image/gif": "image/gif" };
/** A photo by URL as image data for a slide; null if it can't be fetched (the slide then shows a placeholder). */
async function imageData(url) {
    if (!url || !/^https:\/\//i.test(url))
        return null;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok)
            return null;
        const type = IMAGE_TYPES[(0, lib_1.clean)(response.headers.get("content-type")).toLowerCase().split(";")[0]];
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!type || !bytes.length || bytes.length > 8 * 1024 * 1024)
            return null;
        return `${type};base64,${bytes.toString("base64")}`;
    }
    catch {
        return null;
    }
}
exports.imageData = imageData;
/** A photo filling a box, cropped to it (as the web's canvas crop did). */
const coverImage = (data, x, y, w, h, rounding = false) => ({ data, x, y, w, h, rounding, sizing: { type: "cover", w, h } });
exports.coverImage = coverImage;
/** A new deck on the template; `footer` is the centre's name printed on every content slide. */
function newDeck(options) {
    const pptx = new pptxgenjs_1.default();
    pptx.layout = "LAYOUT_WIDE";
    pptx.title = options.title;
    pptx.company = "Lepharo Incubation Programme NPC";
    pptx.author = options.author;
    let pageNo = 0;
    const contentSlide = (title) => {
        pageNo += 1;
        const slide = pptx.addSlide();
        slide.background = background("content");
        slide.addShape(pptx.ShapeType.ellipse, { x: 12.65, y: 0.8, w: 0.36, h: 0.36, fill: { color: CIRCLE }, line: { color: CIRCLE } });
        slide.addText(String(pageNo), { x: 12.65, y: 0.8, w: 0.36, h: 0.36, align: "center", valign: "middle", fontFace: exports.FONT, fontSize: 11, color: "FFFFFF", margin: 0 });
        slide.addText(options.footer, { x: 6.62, y: 6.9, w: 1.9, h: 0.22, fontFace: exports.FONT, fontSize: 8, bold: true, color: exports.MAROON, margin: 0 });
        if (title) {
            slide.addText(title, { x: 1.6, y: 0.62, w: 10.2, h: 0.5, align: "center", valign: "middle", fontFace: exports.FONT, fontSize: 24, bold: true, color: exports.MAROON });
        }
        return slide;
    };
    const emptyNote = (slide, text) => slide.addText(text, { x: exports.AREA.x, y: 3.4, w: exports.AREA.w, h: 0.5, align: "center", fontFace: exports.FONT, fontSize: 16, italic: true, color: "7F7F7F" });
    const coverSlide = () => {
        pageNo += 1;
        const slide = pptx.addSlide();
        slide.background = background("cover");
        return slide;
    };
    const closingSlide = () => {
        const slide = pptx.addSlide();
        slide.background = background("closing");
        return slide;
    };
    return { pptx, contentSlide, emptyNote, coverSlide, closingSlide };
}
exports.newDeck = newDeck;
/** The presenter block shared by every cover. */
function addCover(deck, input) {
    const slide = deck.coverSlide();
    slide.addText([
        { text: input.centre, options: { fontSize: 22, bold: true, color: exports.MAROON, breakLine: true } },
        { text: input.title, options: { fontSize: 15, bold: true, color: exports.MAROON } },
    ], { x: 0.62, y: 2.45, w: 6.2, h: 0.9, fontFace: exports.FONT, valign: "top", margin: 0 });
    slide.addText(input.dateLabel, { x: 0.66, y: 3.6, w: 3, h: 0.35, fontFace: exports.FONT, fontSize: 14, bold: true, color: exports.MAROON, margin: 0 });
    slide.addText([
        { text: "Presented by:", options: { breakLine: true } },
        { text: input.presenter.name, options: { breakLine: true } },
        { text: input.presenter.title, options: { breakLine: true } },
        { text: input.centre, options: { breakLine: true } },
        { text: "Lepharo Incubation Programme NPC" },
    ], { x: 0.62, y: 4.25, w: 3.6, h: 1.25, fontFace: exports.FONT, fontSize: 10, bold: true, color: exports.MAROON, valign: "top", margin: 0, paraSpaceAfter: 2 });
    if (input.photo)
        slide.addImage((0, exports.coverImage)(input.photo, 3.0, 2.95, 1.2, 1.2));
    slide.addText(`Report period: ${input.period}`, { x: 0.62, y: 5.5, w: 4, h: 0.25, fontFace: exports.FONT, fontSize: 9, color: "595959", margin: 0 });
}
exports.addCover = addCover;
/** The thank-you slide shared by every deck. */
function addClosing(deck, input) {
    const slide = deck.closingSlide();
    slide.addText("Thank You", { x: 0.8, y: 1.3, w: 5.5, h: 0.95, fontFace: exports.FONT, fontSize: 54, color: exports.MAROON, margin: 0 });
    slide.addText(input.centre, { x: 0.9, y: 2.35, w: 5.5, h: 0.45, fontFace: exports.FONT, fontSize: 20, color: exports.MAROON, margin: 0 });
    slide.addText([
        { text: "Presented by", options: { bold: true, breakLine: true } },
        { text: input.presenter.name, options: { breakLine: true } },
        { text: `${input.presenter.title}, ${input.centre}`, options: { breakLine: true } },
        { text: "Lepharo Incubation Programme NPC", options: { breakLine: true } },
        { text: " ", options: { breakLine: true } },
        { text: "CONTACT DETAILS:", options: { bold: true, breakLine: true } },
        { text: `E: ${input.email}` },
    ], { x: 0.9, y: 3.4, w: 4.5, h: 1.6, fontFace: exports.FONT, fontSize: 11, color: exports.TEXT, valign: "top", margin: 0 });
}
exports.addClosing = addClosing;
/** A numbered agenda slide. */
function addAgenda(deck, agenda) {
    const slide = deck.contentSlide("AGENDA");
    const lines = [];
    agenda.forEach(([item, children], index) => {
        lines.push({ text: `${index + 1}. ${item.toUpperCase()}`, options: { breakLine: true } });
        children?.forEach((child, i) => lines.push({ text: `${i + 1}. ${child.toUpperCase()}`, options: { indentLevel: 1, breakLine: true } }));
    });
    slide.addText(lines, { x: 1.2, y: 1.6, w: 9, h: 4.6, fontFace: exports.FONT, fontSize: 16, color: exports.TEXT, valign: "top", paraSpaceAfter: 6 });
}
exports.addAgenda = addAgenda;
async function deckBuffer(deck) {
    return Buffer.from(await deck.pptx.write({ outputType: "nodebuffer" }));
}
exports.deckBuffer = deckBuffer;
//# sourceMappingURL=deck.js.map