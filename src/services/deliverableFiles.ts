// Which files on an assignment are its deliverable (POE). Legacy `poe` and
// `document` files count; signed agreements and shared links do not. An
// explicit `role` on the file always wins. This mirrors the check the
// Cloud Function uses when it works out how well an outcome is supported.

const DELIVERABLE_TYPES = ['poe', 'document', 'evidence']

export function hasDeliverableFile(resources: unknown): boolean {
    if (!Array.isArray(resources)) return false
    return resources.some((item: any) => {
        if (!/^https?:\/\//i.test(String(item?.link ?? ''))) return false
        const role = String(item?.role ?? '').trim().toLowerCase()
        if (role === 'deliverable') return true
        if (role === 'other') return false
        return DELIVERABLE_TYPES.includes(String(item?.type ?? '').trim().toLowerCase())
    })
}
