import JSZip from 'jszip'
import type { ReportBlock, ReportTemplate } from '../types'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const xml = (value: string) => new DOMParser().parseFromString(value, 'application/xml')
const elements = (node: ParentNode, name: string) => Array.from(node.querySelectorAll('*')).filter(item => item.localName === name) as Element[]
const direct = (node: Element, name: string) => Array.from(node.children).filter(item => item.localName === name)
const blockText = (block: ReportBlock) => {
  if (typeof block.content === 'string') return block.content
  if (Array.isArray(block.content?.rows)) return block.content.rows.map((row: any) => Object.values(row || {}).join(' | ')).join('\n')
  return String(block.content || '')
}

/**
 * Writes text into a paragraph or cell, keeping the first run's formatting. Each line
 * becomes its own text with a Word line break between (a newline inside one w:t is
 * ignored by Word, so multi-line answers used to run together).
 */
const setText = (node: Element, value: string) => {
  const docNode = node.ownerDocument!
  const lines = String(value ?? '').split(/\r?\n/)
  const texts = elements(node, 't')
  const firstRun = texts[0]?.parentElement && texts[0].parentElement.localName === 'r' ? texts[0].parentElement : null
  // Clear what was there, keeping the first run (and its formatting) to write into.
  texts.slice(1).forEach(item => { item.textContent = '' })
  const run = firstRun || node.appendChild(docNode.createElementNS(WORD_NS, 'w:r'))
  Array.from(run.childNodes)
    .filter(child => (child as Element).localName === 't' || (child as Element).localName === 'br')
    .forEach(child => run.removeChild(child))
  lines.forEach((line, i) => {
    if (i > 0) run.appendChild(docNode.createElementNS(WORD_NS, 'w:br'))
    const text = docNode.createElementNS(WORD_NS, 'w:t')
    text.setAttribute('xml:space', 'preserve')
    text.textContent = line
    run.appendChild(text)
  })
}

const tableRows = (block: ReportBlock) => Array.isArray(block.content?.rows) ? block.content.rows : []

const fillTable = (table: Element, block: ReportBlock) => {
  const values = tableRows(block)
  const rows = direct(table, 'tr')
  const headerRow = rows[0]
  const templateRow = rows[1] || headerRow
  if (!templateRow) return
  const columns = block.schema?.columns?.length ? block.schema.columns : Object.keys(values[0] || {})

  // Keep the original header and row formatting, but never retain old-quarter data.
  rows.slice(1).forEach(row => table.removeChild(row))
  values.forEach((value: any) => {
    const row = templateRow.cloneNode(true) as Element
    const cells = direct(row, 'tc')
    cells.forEach((cell, columnIndex) => setText(cell, String(value?.[columns[columnIndex]] ?? '')))
    table.appendChild(row)
  })
}

const sourceNodeMap = (document: XMLDocument) => {
  const body = elements(document, 'body')[0]
  if (!body) throw new Error('The DOCX has no readable document body.')
  let paragraph = 0
  let table = 0
  const map = new Map<string, Element>()
  Array.from(body.children).forEach(node => {
    if (node.localName === 'p') map.set(`p-${++paragraph}`, node)
    if (node.localName === 'tbl') map.set(`t-${++table}`, node)
  })
  return map
}

/** What a download would leave out or include unfinished, so people are told before they export. */
export const summarizeExport = (blocks: ReportBlock[]) => ({
  unmapped: blocks.filter(block => block.contentType !== 'static' && !block.sourceDocumentNodeIds?.length).map(block => block.title),
  unfinished: blocks.filter(block => block.status !== 'approved').map(block => block.title)
})

export const generateReportDocx = async ({
  template,
  blocks
}: {
  template: ReportTemplate
  blocks: ReportBlock[]
}) => {
  if (!template.sourceFile?.url) throw new Error('This template has no source DOCX file.')
  const mapped = blocks.filter(block => block.sourceDocumentNodeIds?.length)
  if (!mapped.length) throw new Error('Map at least one template block to the extracted DOCX before generating Word.')

  const response = await fetch(template.sourceFile.url)
  if (!response.ok) throw new Error('Could not download the source DOCX.')
  const zip = await JSZip.loadAsync(await response.arrayBuffer())
  const source = await zip.file('word/document.xml')?.async('string')
  if (!source) throw new Error('The source DOCX has no document.xml content.')

  const document = xml(source)
  const nodes = sourceNodeMap(document)
  mapped.forEach(block => block.sourceDocumentNodeIds?.forEach(id => {
    const node = nodes.get(id)
    if (!node) return
    if (node.localName === 'tbl') fillTable(node, block)
    // Structured data belongs in its mapped Word table. Never flatten it into
    // a paragraph when an accidental extra paragraph mapping is selected.
    else if (block.contentType !== 'table' && block.contentType !== 'kpi') setText(node, blockText(block))
  }))
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document))
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  })
}

export const downloadDocx = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'report.docx'
  link.click()
  // Some browsers start the download after click() returns; release the link a little later.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
