import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import { saveAs } from 'file-saver'

export type FillDocxTemplateParams = {
    templateUrl: string
    data: Record<string, unknown>
    filenameBase: string
}

function sanitizeFilenamePart(value: string) {
    return value
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160)
}

async function fetchTemplateArrayBuffer(templateUrl: string) {
    const response = await fetch(templateUrl)
    if (!response.ok) {
        throw new Error(`Unable to load DOCX template (${response.status})`)
    }
    return response.arrayBuffer()
}

export async function fillDocxTemplateAndDownload({
    templateUrl,
    data,
    filenameBase
}: FillDocxTemplateParams) {
    const content = await fetchTemplateArrayBuffer(templateUrl)
    const zip = new PizZip(content)

    const doc = new Docxtemplater(zip, {
        delimiters: {
            start: '{{',
            end: '}}'
        },
        paragraphLoop: true,
        linebreaks: true,
        nullGetter: () => ''
    })

    doc.render(data)

    const blob = doc.getZip().generate({
        type: 'blob',
        mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })

    saveAs(blob, `${sanitizeFilenamePart(filenameBase) || 'Executive-Report'}.docx`)
}
