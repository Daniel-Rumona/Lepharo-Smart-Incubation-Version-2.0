import { getAuth } from 'firebase/auth'
import type { ReportBlock } from '../types'

const AI_BASE_URL = String(import.meta.env.VITE_AI_BACKEND_URL || 'https://yoursdvniel-lepharo-smart-incubation.hf.space').replace(/\/$/, '')
export type ReportWritingAction = 'improve' | 'summarise' | 'expand' | 'commentary' | 'risk_mitigation' | 'conclusion'

export const requestReportWriting = async (action: ReportWritingAction, block: ReportBlock, content: unknown, instruction = '') => {
  const user = getAuth().currentUser
  if (!user) throw new Error('Please sign in again to use writing assistance.')
  const response = await fetch(`${AI_BASE_URL}/report-writing`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ action, title: block.title, sectionTitle: block.sectionTitle, contentType: block.contentType, content, instruction })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || 'Writing assistance failed.')
  return String(data.suggestion || '').trim()
}
