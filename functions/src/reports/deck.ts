import * as fs from "fs";
import * as path from "path";
import PptxGenJS from "pptxgenjs";
import { clean } from "./lib";

/**
 * The Lepharo report template shared by every report deck: the three backgrounds in
 * assets/report-templates (the original centre slides with their text blanked out), the numbered red
 * circle, and the content area. Each report draws its own slides on top.
 */

export const MAROON = "7B1416";
const CIRCLE = "791315";
export const BLUE = "4472C4";
export const BLUE_LIGHT = "DAE3F3";
export const TEXT = "262626";
export const FONT = "Calibri";

// Content area on the template, in inches (13.333 x 7.5 slide).
export const AREA = { x: 0.6, y: 1.4, w: 12.1, h: 5.05 };

const TEMPLATE_DIR = path.join(__dirname, "..", "..", "assets", "report-templates");
const backgrounds = new Map<string, string>();
const background = (name: "cover" | "content" | "closing") => {
  if (!backgrounds.has(name)) {
    backgrounds.set(name, `image/jpeg;base64,${fs.readFileSync(path.join(TEMPLATE_DIR, `${name}.jpg`)).toString("base64")}`);
  }
  return { data: backgrounds.get(name)! };
};

export const chunk = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

export const headerCell = (text: string, fill = BLUE) => ({ text, options: { bold: true, color: "FFFFFF", fill: { color: fill } } });

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg", "image/png": "image/png", "image/gif": "image/gif" };

/** A photo by URL as image data for a slide; null if it can't be fetched (the slide then shows a placeholder). */
export async function imageData(url: string | undefined): Promise<string | null> {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const type = IMAGE_TYPES[clean(response.headers.get("content-type")).toLowerCase().split(";")[0]];
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!type || !bytes.length || bytes.length > 8 * 1024 * 1024) return null;
    return `${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** A photo filling a box, cropped to it (as the web's canvas crop did). */
export const coverImage = (data: string, x: number, y: number, w: number, h: number, rounding = false) =>
  ({ data, x, y, w, h, rounding, sizing: { type: "cover" as const, w, h } });

export type Deck = {
  pptx: PptxGenJS;
  contentSlide: (title: string) => PptxGenJS.Slide;
  emptyNote: (slide: PptxGenJS.Slide, text: string) => void;
  coverSlide: () => PptxGenJS.Slide;
  closingSlide: () => PptxGenJS.Slide;
};

/** A new deck on the template; `footer` is the centre's name printed on every content slide. */
export function newDeck(options: { title: string; author: string; footer: string }): Deck {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = options.title;
  pptx.company = "Lepharo Incubation Programme NPC";
  pptx.author = options.author;
  let pageNo = 0;

  const contentSlide = (title: string) => {
    pageNo += 1;
    const slide = pptx.addSlide();
    slide.background = background("content");
    slide.addShape(pptx.ShapeType.ellipse, { x: 12.65, y: 0.8, w: 0.36, h: 0.36, fill: { color: CIRCLE }, line: { color: CIRCLE } });
    slide.addText(String(pageNo), { x: 12.65, y: 0.8, w: 0.36, h: 0.36, align: "center", valign: "middle", fontFace: FONT, fontSize: 11, color: "FFFFFF", margin: 0 });
    slide.addText(options.footer, { x: 6.62, y: 6.9, w: 1.9, h: 0.22, fontFace: FONT, fontSize: 8, bold: true, color: MAROON, margin: 0 });
    if (title) {
      slide.addText(title, { x: 1.6, y: 0.62, w: 10.2, h: 0.5, align: "center", valign: "middle", fontFace: FONT, fontSize: 24, bold: true, color: MAROON });
    }
    return slide;
  };

  const emptyNote = (slide: PptxGenJS.Slide, text: string) =>
    slide.addText(text, { x: AREA.x, y: 3.4, w: AREA.w, h: 0.5, align: "center", fontFace: FONT, fontSize: 16, italic: true, color: "7F7F7F" });

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

/** The presenter block shared by every cover. */
export function addCover(
  deck: Deck,
  input: { centre: string; title: string; dateLabel: string; period: string; presenter: { name: string; title: string }; photo: string | null },
) {
  const slide = deck.coverSlide();
  slide.addText(
    [
      { text: input.centre, options: { fontSize: 22, bold: true, color: MAROON, breakLine: true } },
      { text: input.title, options: { fontSize: 15, bold: true, color: MAROON } },
    ],
    { x: 0.62, y: 2.45, w: 6.2, h: 0.9, fontFace: FONT, valign: "top", margin: 0 },
  );
  slide.addText(input.dateLabel, { x: 0.66, y: 3.6, w: 3, h: 0.35, fontFace: FONT, fontSize: 14, bold: true, color: MAROON, margin: 0 });
  slide.addText(
    [
      { text: "Presented by:", options: { breakLine: true } },
      { text: input.presenter.name, options: { breakLine: true } },
      { text: input.presenter.title, options: { breakLine: true } },
      { text: input.centre, options: { breakLine: true } },
      { text: "Lepharo Incubation Programme NPC" },
    ],
    { x: 0.62, y: 4.25, w: 3.6, h: 1.25, fontFace: FONT, fontSize: 10, bold: true, color: MAROON, valign: "top", margin: 0, paraSpaceAfter: 2 },
  );
  if (input.photo) slide.addImage(coverImage(input.photo, 3.0, 2.95, 1.2, 1.2));
  slide.addText(`Report period: ${input.period}`, { x: 0.62, y: 5.5, w: 4, h: 0.25, fontFace: FONT, fontSize: 9, color: "595959", margin: 0 });
}

/** The thank-you slide shared by every deck. */
export function addClosing(deck: Deck, input: { centre: string; presenter: { name: string; title: string }; email: string }) {
  const slide = deck.closingSlide();
  slide.addText("Thank You", { x: 0.8, y: 1.3, w: 5.5, h: 0.95, fontFace: FONT, fontSize: 54, color: MAROON, margin: 0 });
  slide.addText(input.centre, { x: 0.9, y: 2.35, w: 5.5, h: 0.45, fontFace: FONT, fontSize: 20, color: MAROON, margin: 0 });
  slide.addText(
    [
      { text: "Presented by", options: { bold: true, breakLine: true } },
      { text: input.presenter.name, options: { breakLine: true } },
      { text: `${input.presenter.title}, ${input.centre}`, options: { breakLine: true } },
      { text: "Lepharo Incubation Programme NPC", options: { breakLine: true } },
      { text: " ", options: { breakLine: true } },
      { text: "CONTACT DETAILS:", options: { bold: true, breakLine: true } },
      { text: `E: ${input.email}` },
    ],
    { x: 0.9, y: 3.4, w: 4.5, h: 1.6, fontFace: FONT, fontSize: 11, color: TEXT, valign: "top", margin: 0 },
  );
}

/** A numbered agenda slide. */
export function addAgenda(deck: Deck, agenda: Array<[string, string[]?]>) {
  const slide = deck.contentSlide("AGENDA");
  const lines: PptxGenJS.TextProps[] = [];
  agenda.forEach(([item, children], index) => {
    lines.push({ text: `${index + 1}. ${item.toUpperCase()}`, options: { breakLine: true } });
    children?.forEach((child, i) => lines.push({ text: `${i + 1}. ${child.toUpperCase()}`, options: { indentLevel: 1, breakLine: true } }));
  });
  slide.addText(lines, { x: 1.2, y: 1.6, w: 9, h: 4.6, fontFace: FONT, fontSize: 16, color: TEXT, valign: "top", paraSpaceAfter: 6 });
}

export async function deckBuffer(deck: Deck) {
  return Buffer.from(await deck.pptx.write({ outputType: "nodebuffer" }) as ArrayBuffer);
}
