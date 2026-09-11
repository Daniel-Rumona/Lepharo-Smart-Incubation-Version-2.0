// src/services/poeService.ts

import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/firebase'

/**
 * Extract POE URLs from ANY record
 */
const validUrl = (value: any): value is string =>
    typeof value === 'string' && /^https?:\/\//i.test(value)

export function extractCanonicalPoeUrls(record?: any): string[] {
    if (!record) return []
    const urls: string[] = []

    if (Array.isArray(record.poeUrls)) {
        record.poeUrls.forEach((url: any) => validUrl(url) && urls.push(url))
    }
    if (Array.isArray(record.resources)) {
        record.resources.forEach((item: any) => {
            if (validUrl(item?.link)) urls.push(item.link)
        })
    }
    return [...new Set(urls)]
}

/** Read only the canonical managed POE field. */
export function extractPoeUrls(record?: any): string[] {
    return extractCanonicalPoeUrls(record)
}

/**
 * Resolve POE from all possible sources
 */
export async function resolveMovPoe(mov: any, queriesIndex?: any) {
    let urls: string[] = []

    // 1. From MOV itself
    urls = urls.concat(extractPoeUrls(mov))

    // 2. From queries (latest uploaded evidence)
    if (queriesIndex?.lastEvidenceUrl) {
        urls.push(queriesIndex.lastEvidenceUrl)
    }

    // 3. Assignment record (canonical relationship from MOV)
    const assignedInterventionId = String(mov?.assignedInterventionId || '').trim()
    if (assignedInterventionId) {
        try {
            const snap = await getDoc(doc(db, 'assignedInterventions', assignedInterventionId))
            if (snap.exists()) {
                urls = urls.concat(extractPoeUrls(snap.data()))
            }
        } catch {}
    }

    return Array.from(new Set(urls.filter(Boolean)))
}

/**
 * Quick boolean check (used everywhere)
 */
export async function hasMovPoe(mov: any, queriesIndex?: any): Promise<boolean> {
    const urls = await resolveMovPoe(mov, queriesIndex)
    return urls.length > 0
}

/**
 * Sync version (for already-enriched data)
 */
export function hasMovPoeSync(mov: any, queriesIndex?: any): boolean {
    const urls = [
        ...extractPoeUrls(mov),
        ...(queriesIndex?.lastEvidenceUrl ? [queriesIndex.lastEvidenceUrl] : [])
    ]

    return urls.length > 0
}

/**
 * Get primary POE (for UI buttons)
 */
export async function getPrimaryPoeUrl(mov: any, queriesIndex?: any): Promise<string | null> {
    const urls = await resolveMovPoe(mov, queriesIndex)
    return urls[0] || null
}
