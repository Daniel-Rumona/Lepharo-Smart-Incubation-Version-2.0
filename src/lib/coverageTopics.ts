/** Conservative matching: no fuzzy matching or splitting of narrative coverage. */
const normalize = (text: string) => text.normalize('NFKC').toLowerCase()
    .replace(/specialized/g, 'specialised')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const safetyTitle = 'Apply and maintain safety in working environments'
const safetyAliases = new Set([
    safetyTitle,
    'Apply and Maintain safety in a working environment',
    'Apply and Maintain safety in working environments.'
].map(normalize))

// Preferred display wording for the variants reviewed with the user.
const standardTitles: Record<string, string> = {
    '244494': 'Unit Standard 244494: Specialised fault finding and repairs to plumbing systems',
    '244500': 'Unit Standard 244500: Install specialised hospital sanitaryware systems'
}

export function coverageTopicKey(text: string): string {
    const normalized = normalize(text)
    const codes = [...text.matchAll(/\b(?:unit\s*standard|u\.?\s*s\.?)\s*[:#-]?\s*(\d{4,6})\b/gi)]
    // Multi-standard / numbered descriptions remain separate entries.
    if (codes.length === 1) return `us:${codes[0][1]}`
    if (safetyAliases.has(normalized)) return 'alias:workplace-safety'
    return normalized ? `text:${normalized}` : ''
}

export function buildCoverageTopicCatalog(values: readonly string[]): string[] {
    const labels = new Map<string, string>()
    for (const raw of values.filter(value => typeof value === 'string').slice().sort()) {
        const label = raw.trim().replace(/\s+/g, ' ')
        const key = coverageTopicKey(label)
        if (!key || labels.has(key)) continue
        const preferred = key === 'alias:workplace-safety'
            ? safetyTitle
            : key.startsWith('us:') ? standardTitles[key.slice(3)] : undefined
        labels.set(key, preferred || label)
    }
    return [...labels.values()].sort((a, b) => a.localeCompare(b))
}

export function canonicalizeCoverageTopics(values: string[], catalog: string[]): string[] {
    const labels = new Map(buildCoverageTopicCatalog([...catalog, ...values]).map(label => [coverageTopicKey(label), label]))
    return [...new Set(values.map(coverageTopicKey).filter(Boolean))].map(key => labels.get(key)!)
}

type TopicRow = {
    id?: string
    appointmentSessionId?: string
    sessionCoverage?: { latest?: { coveredPoints?: string[] } }
}

export function aggregateCoverageTopics(rows: TopicRow[]) {
    const catalog = buildCoverageTopicCatalog(rows.flatMap(row => row.sessionCoverage?.latest?.coveredPoints || []))
    const sessions = new Map<string, Set<string>>()
    rows.forEach((row, index) => {
        const sessionId = row.appointmentSessionId || row.id || `row:${index}`
        for (const topic of row.sessionCoverage?.latest?.coveredPoints || []) {
            const key = coverageTopicKey(topic)
            if (!key) continue
            if (!sessions.has(key)) sessions.set(key, new Set())
            sessions.get(key)!.add(sessionId)
        }
    })
    return catalog.map(topic => ({ topic, count: sessions.get(coverageTopicKey(topic))!.size }))
        .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
}
