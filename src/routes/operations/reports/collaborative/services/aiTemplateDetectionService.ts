import { getAuth } from 'firebase/auth'
import type { ExtractedDocumentStructure, ReportContentType } from '../types'

const AI_BASE_URL = String(import.meta.env.VITE_AI_BACKEND_URL || 'https://yoursdvniel-lepharo-smart-incubation.hf.space').replace(/\/$/, '')

export type TemplateDetectionSuggestion = {
  nodeIds: string[]
  sectionTitle: string
  title: string
  contentType: ReportContentType
  confidence: number
}

export const detectTemplateBlocks = async (templateName: string, frequency: string, structure: ExtractedDocumentStructure) => {
  const user = getAuth().currentUser
  if (!user) throw new Error('Please sign in again to use template detection.')
  const response = await fetch(`${AI_BASE_URL}/template-detection`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ templateName, frequency, nodes: structure.nodes.map(node => ({ id: node.id, kind: node.kind, text: node.text })) })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || 'Template detection failed.')
  return Array.isArray(data.suggestions) ? data.suggestions as TemplateDetectionSuggestion[] : []
}
