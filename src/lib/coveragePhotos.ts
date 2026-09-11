export type CoverageReviewPhoto = {
    url: string
    sessionId: string
    title: string
    date: string
}

/** Group invitations repeat the same session photos. Show each once per session. */
export function getCoveragePhotoUrls(row: any): string[] {
    // An explicit session photo list, including [], is authoritative. Cached group
    // invitations may still contain photos removed in the current coverage edit.
    const rows = Array.isArray(row?.sessionCoverage?.latest?.photos)
        ? [row]
        : [row, ...(Array.isArray(row?._groupMembers) ? row._groupMembers : [])]
    return [...new Set<string>(rows.flatMap(item => {
        const photos = item?.sessionCoverage?.latest?.photos
        return Array.isArray(photos)
            ? photos.filter((url): url is string => typeof url === 'string')
                .map(url => url.trim()).filter(url => /^https?:\/\//i.test(url))
            : []
    }))]
}

export function getCoverageReviewPhotos(rows: any[]): CoverageReviewPhoto[] {
    const photos = new Map<string, CoverageReviewPhoto>()
    rows.forEach(row => {
        const sessionId = String(row.appointmentSessionId || row.id)
        getCoveragePhotoUrls(row).forEach(url => {
            const key = `${sessionId}|${url}`
            if (!photos.has(key)) photos.set(key, {
                url, sessionId,
                title: row.sessionTitle || row.sessionCoverage?.title || row.interventionTitle || 'Session',
                date: row.date || ''
            })
        })
    })
    return [...photos.values()]
}
