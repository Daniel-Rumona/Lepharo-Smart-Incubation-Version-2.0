import JSZip from 'jszip'
import type { ExtractedDocumentNode, ExtractedDocumentStructure } from '../types'

const xml = (value: string) => new DOMParser().parseFromString(value, 'application/xml')
const children = (node: Element) => Array.from(node.children)
const named = (node: ParentNode, name: string) => Array.from(node.querySelectorAll('*')).filter(item => item.localName === name)
const first = (node: ParentNode, name: string) => named(node, name)[0] as Element | undefined
const attr = (node: Element | undefined, name: string) => node?.getAttribute(`w:${name}`) || node?.getAttribute(name) || undefined
const text = (node: ParentNode) => named(node, 't').map(item => item.textContent || '').join('').trim()

const paragraphNode = (element: Element, index: number): ExtractedDocumentNode => {
  const properties = first(element, 'pPr')
  const style = attr(first(properties || element, 'pStyle'), 'val')
  return {
    id: `p-${index + 1}`,
    kind: 'paragraph',
    text: text(element),
    ...(style ? { style } : {}),
    ...(first(properties || element, 'numPr') ? { list: true } : {})
  }
}

const tableNode = (element: Element, index: number): ExtractedDocumentNode => ({
  id: `t-${index + 1}`,
  kind: 'table',
  text: named(element, 'tr').map(row => text(row)).filter(Boolean).join(' | '),
  rows: Object.fromEntries(named(element, 'tr').map((row, rowIndex) => [`row-${rowIndex + 1}`, Object.fromEntries(
    children(row).filter(cell => cell.localName === 'tc').map((cell, cellIndex) => {
      const properties = first(cell, 'tcPr')
      const merge = attr(first(properties || cell, 'vMerge'), 'val')
      return [`cell-${cellIndex + 1}`, {
        text: text(cell),
        colSpan: Number(attr(first(properties || cell, 'gridSpan'), 'val') || 1),
        ...(merge === 'restart' ? { rowSpan: 2 } : {})
      }]
    })
  )]))
})

export const extractDocxStructure = async (file: Blob): Promise<ExtractedDocumentStructure> => {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) throw new Error('This file does not contain a readable Word document body.')

  const document = xml(documentXml)
  const body = Array.from(document.querySelectorAll('*')).find(item => item.localName === 'body') as Element | undefined
  if (!body) throw new Error('The Word document body could not be read.')

  let paragraphIndex = 0
  let tableIndex = 0
  const nodes = children(body).flatMap(element => {
    if (element.localName === 'p') return [paragraphNode(element, paragraphIndex++)]
    if (element.localName === 'tbl') return [tableNode(element, tableIndex++)]
    return []
  }).filter(node => node.kind === 'table' || node.text)

  const stylesXml = await zip.file('word/styles.xml')?.async('string')
  const styles = stylesXml ? named(xml(stylesXml), 'style').map(item => attr(item, 'styleId')).filter((item): item is string => Boolean(item)) : []
  const files = Object.keys(zip.files)
  return {
    version: 1,
    extractedAt: new Date().toISOString(),
    paragraphs: nodes.filter(node => node.kind === 'paragraph').length,
    tables: nodes.filter(node => node.kind === 'table').length,
    images: files.filter(path => path.startsWith('word/media/')).length,
    headers: files.filter(path => /^word\/header\d+\.xml$/.test(path)).length,
    footers: files.filter(path => /^word\/footer\d+\.xml$/.test(path)).length,
    styles,
    nodes
  }
}
