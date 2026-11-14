/**
 * Reads a questionnaire's printed design (letterhead, logo, rating legend,
 * sign-off lines) from an uploaded PDF or Word file, in the browser. The
 * questions themselves are read by the AI importer
 * (surveyQuestionExtractionService); this only reads the look.
 */
import JSZip from 'jszip'
import { pdfjs } from 'react-pdf'
import {
    designFromPdfPages,
    emptyExportDesign,
    MAX_LOGO_DIMENSION,
    type DesignPair,
    type PdfPageTokens,
    type SurveyExportDesign
} from '@/lib/surveyExportDesign'

// Same worker as DocumentViewer; react-pdf's own default doesn't resolve
// under Vite, so it is always set here.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString()

const extensionOf = (name: string) => (name.split('.').pop() || '').toLowerCase()

/** Only PDF and Word files carry a layout worth reading. */
export const canReadExportDesign = (file: File | null | undefined) =>
    !!file && ['pdf', 'docx'].includes(extensionOf(file.name))

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Draws any image source onto a canvas no bigger than MAX_LOGO_DIMENSION. */
const canvasToDataUrl = (
    draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
    sourceWidth: number,
    sourceHeight: number
): string | undefined => {
    if (!sourceWidth || !sourceHeight) return undefined
    const scale = Math.min(1, MAX_LOGO_DIMENSION / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    draw(ctx, width, height)
    // PNG keeps transparency; logos are small enough that it stays light.
    return canvas.toDataURL('image/png')
}

const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('The image could not be read.'))
        img.src = src
    })

/** Any image file or URL, resized for storing on the template. */
export const imageToLogoDataUrl = async (source: Blob | string): Promise<string> => {
    const url = typeof source === 'string' ? source : URL.createObjectURL(source)
    try {
        const img = await loadImage(url)
        const dataUrl = canvasToDataUrl(
            (ctx, width, height) => ctx.drawImage(img, 0, 0, width, height),
            img.naturalWidth,
            img.naturalHeight
        )
        if (!dataUrl) throw new Error('The image could not be read.')
        return dataUrl
    } finally {
        if (typeof source !== 'string') URL.revokeObjectURL(url)
    }
}

/** The organisation's own logo, for designs that don't bring one. */
export const DEFAULT_LOGO_PATH = '/assets/images/lepharo.png'

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

type PdfImage = {
    width: number
    height: number
    bitmap?: ImageBitmap
    data?: Uint8ClampedArray | Uint8Array
    kind?: number
}

const pdfImageToDataUrl = (image: PdfImage): string | undefined => {
    const { width, height } = image
    if (image.bitmap) {
        return canvasToDataUrl(
            (ctx, w, h) => ctx.drawImage(image.bitmap as ImageBitmap, 0, 0, w, h),
            width,
            height
        )
    }
    if (!image.data) return undefined
    // pdf.js ImageKind: 1 = 1bpp greyscale, 2 = RGB, 3 = RGBA.
    const rgba = new Uint8ClampedArray(width * height * 4)
    if (image.kind === 3) {
        rgba.set(image.data.subarray(0, rgba.length))
    } else if (image.kind === 2) {
        for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) {
            rgba[j] = image.data[i]
            rgba[j + 1] = image.data[i + 1]
            rgba[j + 2] = image.data[i + 2]
            rgba[j + 3] = 255
        }
    } else {
        return undefined
    }
    const full = document.createElement('canvas')
    full.width = width
    full.height = height
    full.getContext('2d')?.putImageData(new ImageData(rgba, width, height), 0, 0)
    return canvasToDataUrl((ctx, w, h) => ctx.drawImage(full, 0, 0, w, h), width, height)
}

/** pdf.js resolves page images asynchronously; give it a moment, not forever. */
const getPdfObject = (objs: any, id: string): Promise<PdfImage | null> =>
    new Promise(resolve => {
        const timer = window.setTimeout(() => resolve(null), 4000)
        try {
            objs.get(id, (value: PdfImage) => {
                window.clearTimeout(timer)
                resolve(value || null)
            })
        } catch {
            window.clearTimeout(timer)
            resolve(null)
        }
    })

/**
 * The letterhead logo: the first image drawn in the top quarter of page one.
 * Tracks the transform stack so a body image isn't mistaken for it.
 */
const readPdfLogo = async (page: any): Promise<string | undefined> => {
    const ops = await page.getOperatorList()
    const { OPS } = pdfjs
    const [, , , pageHeight] = page.view as number[]
    const multiply = (m: number[], n: number[]) => [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5]
    ]
    let ctm = [1, 0, 0, 1, 0, 0]
    const stack: number[][] = []

    for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i]
        const args = ops.argsArray[i]
        if (fn === OPS.save) stack.push(ctm)
        else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
        else if (fn === OPS.transform) ctm = multiply(ctm, args as number[])
        else if (fn === OPS.paintImageXObject) {
            // The image fills the unit square under the current transform.
            const top = ctm[5] + Math.max(0, ctm[3])
            const drawnWidth = Math.abs(ctm[0])
            if (top < pageHeight * 0.75 || drawnWidth < 20) continue
            const id = String(args[0])
            const objs = id.startsWith('g_') ? page.commonObjs : page.objs
            const image = await getPdfObject(objs, id)
            const dataUrl = image ? pdfImageToDataUrl(image) : undefined
            if (dataUrl) return dataUrl
        }
    }
    return undefined
}

const readPdfDesign = async (file: File): Promise<SurveyExportDesign> => {
    const data = new Uint8Array(await file.arrayBuffer())
    const doc = await pdfjs.getDocument({ data }).promise
    try {
        const pages: PdfPageTokens[] = []
        // A questionnaire is a few pages; the header repeats on all of them.
        const pageCount = Math.min(doc.numPages, 12)
        for (let number = 1; number <= pageCount; number++) {
            const page = await doc.getPage(number)
            const [, , width, height] = page.view
            const content = await page.getTextContent()
            pages.push({
                width,
                height,
                tokens: content.items
                    .filter((item: any) => typeof item.str === 'string')
                    .map((item: any) => ({
                        str: item.str,
                        x: item.transform[4],
                        y: item.transform[5],
                        width: item.width,
                        height: item.height || Math.hypot(item.transform[2], item.transform[3])
                    }))
            })
        }
        const design = designFromPdfPages(pages)
        try {
            design.logoDataUrl = await readPdfLogo(await doc.getPage(1))
        } catch (error) {
            console.warn('Could not read the logo from the PDF', error)
        }
        return design
    } finally {
        doc.destroy()
    }
}

// ---------------------------------------------------------------------------
// Word (.docx)
// ---------------------------------------------------------------------------

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')

const paragraphText = (p: Element) =>
    Array.from(p.getElementsByTagNameNS(W_NS, 't'))
        .map(t => t.textContent || '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()

const cellText = (cell: Element) =>
    Array.from(cell.getElementsByTagNameNS(W_NS, 'p'))
        .map(paragraphText)
        .filter(Boolean)
        .join('\n')

/** Largest run size in a cell, in half-points; 0 when unset. */
const cellFontSize = (cell: Element) =>
    Math.max(
        0,
        ...Array.from(cell.getElementsByTagNameNS(W_NS, 'sz')).map(sz =>
            Number(sz.getAttributeNS(W_NS, 'val') || sz.getAttribute('w:val') || 0)
        )
    )

const readDocxDesign = async (file: File): Promise<SurveyExportDesign> => {
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const design = emptyExportDesign()

    // The default header is normally the biggest one; first-page and even-page
    // variants are usually blank or a copy.
    const headerNames = Object.keys(zip.files).filter(name => /^word\/header\d*\.xml$/.test(name))
    const headers = await Promise.all(
        headerNames.map(async name => ({ name, xml: await zip.file(name)!.async('string') }))
    )
    headers.sort((a, b) => b.xml.length - a.xml.length)
    const header = headers[0]

    if (header) {
        const doc = parseXml(header.xml)
        const rows = Array.from(doc.getElementsByTagNameNS(W_NS, 'tr'))
        const cells = Array.from(doc.getElementsByTagNameNS(W_NS, 'tc'))
        const isLabel = (text: string) => /^[^:\n]{2,40}:$/.test(text)
        // The title is the biggest non-label text in the header.
        const titleCell = cells
            .filter(cell => cellText(cell) && !isLabel(cellText(cell)))
            .sort((a, b) => cellFontSize(b) - cellFontSize(a))[0]
        if (titleCell) design.headerTitle = cellText(titleCell).replace(/\n/g, ' ')
        const titleRow = titleCell?.closest('tr') || null

        rows.forEach(row => {
            const rowCells = Array.from(row.getElementsByTagNameNS(W_NS, 'tc')).filter(
                cell => cell.closest('tr') === row
            )
            const pairs: DesignPair[] = []
            rowCells.forEach((cell, index) => {
                const text = cellText(cell)
                const inline = text.match(/^([^:\n]{2,40}):\s+([\s\S]+)$/)
                if (isLabel(text)) {
                    pairs.push({
                        label: text.replace(/:$/, '').trim(),
                        value: rowCells[index + 1] ? cellText(rowCells[index + 1]) : ''
                    })
                } else if (inline && cell !== titleCell) {
                    pairs.push({ label: inline[1].trim(), value: inline[2].trim() })
                }
            })
            // Rows level with the title are document control; rows below it,
            // the approvals band.
            const below =
                titleRow && row !== titleRow && !row.contains(titleCell!) &&
                rows.indexOf(row) > rows.indexOf(titleRow as Element)
            ;(below ? design.approvals : design.docControl).push(...pairs)
        })

        // Plain-paragraph headers: "Doc Ref: QMS" lines.
        if (!rows.length) {
            Array.from(doc.getElementsByTagNameNS(W_NS, 'p')).forEach(p => {
                const match = paragraphText(p).match(/^([^:]{2,40}):\s+(.+)$/)
                if (match) design.docControl.push({ label: match[1].trim(), value: match[2].trim() })
            })
        }

        // Logo: the first picture the header's relationships point at.
        const relsName = header.name.replace(/^word\//, 'word/_rels/') + '.rels'
        const rels = zip.file(relsName)
        if (rels) {
            const relsDoc = parseXml(await rels.async('string'))
            const target = Array.from(relsDoc.getElementsByTagName('Relationship'))
                .map(rel => rel.getAttribute('Target') || '')
                .find(t => /\.(png|jpe?g|gif|bmp)$/i.test(t))
            const media = target ? zip.file(`word/${target.replace(/^\.?\//, '')}`) : null
            if (media) {
                try {
                    const ext = extensionOf(target!)
                    const blob = new Blob([await media.async('uint8array')], {
                        type: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
                    })
                    design.logoDataUrl = await imageToLogoDataUrl(blob)
                } catch (error) {
                    console.warn('Could not read the logo from the Word file', error)
                }
            }
        }
    }

    // Body: the same line rules as a PDF, with the header left out.
    const body = zip.file('word/document.xml')
    if (body) {
        const doc = parseXml(await body.async('string'))
        const lines: string[] = []
        Array.from(doc.getElementsByTagNameNS(W_NS, 'tr')).forEach(row => {
            const text = Array.from(row.getElementsByTagNameNS(W_NS, 'tc'))
                .map(cellText)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()
            if (text) lines.push(text)
        })
        Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))
            .filter(p => !p.closest('tc'))
            .forEach(p => {
                const text = paragraphText(p)
                if (text) lines.push(text)
            })
        // Reuse the PDF rules by feeding one token per line.
        const fromBody = designFromPdfPages([
            {
                width: 600,
                // Tall enough that the one-page "top band" rule finds no
                // letterhead among these lines.
                height: 1_000_000,
                tokens: lines.map((str, index) => ({ str, x: 0, y: 90000 - index * 20, width: 10, height: 10 }))
            }
        ])
        design.ratingIntro = fromBody.ratingIntro
        design.ratingLegend = fromBody.ratingLegend
        design.ratingColumnTitle = fromBody.ratingColumnTitle
        design.includeNA = fromBody.includeNA
        design.signOff = fromBody.signOff
    }

    return design
}

/**
 * Reads the printed design of an uploaded questionnaire. Throws only when the
 * file can't be opened at all; anything not found is simply left blank.
 */
export async function readExportDesign(file: File): Promise<SurveyExportDesign> {
    const ext = extensionOf(file.name)
    const design =
        ext === 'pdf'
            ? await readPdfDesign(file)
            : ext === 'docx'
                ? await readDocxDesign(file)
                : null
    if (!design) throw new Error('Upload a PDF or Word (.docx) version of the form to copy its design.')
    design.sourceFileName = file.name
    return design
}
