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

const setText = (node: Element, value: string) => {
  const texts = elements(node, 't')
  if (texts.length) {
    texts[0].textContent = value
    texts.slice(1).forEach(item => { item.textContent = '' })
    return
  }
  const run = node.ownerDocument!.createElementNS(WORD_NS, 'w:r')
  const text = node.ownerDocument!.createElementNS(WORD_NS, 'w:t')
  text.setAttribute('xml:space', 'preserve')
  text.textContent = value
  run.appendChild(text)
  node.appendChild(run)
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
  URL.revokeObjectURL(url)
}
