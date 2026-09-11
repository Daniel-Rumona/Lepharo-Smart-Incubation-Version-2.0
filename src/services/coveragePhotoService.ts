import { getDownloadURL, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage'

// Keep successful uploads on a retry after a failed session save, without uploading again.
const uploads = new WeakMap<FirebaseStorage, WeakMap<Blob, Map<string, Promise<string>>>>()

export function coveragePhotoFiles(items: unknown): Array<Blob & { name: string }> {
    if (!Array.isArray(items)) throw new Error('The photo selection could not be read. Please select the photos again.')
    return items.map(item => {
        const file = item?.originFileObj || item
        if (!(file instanceof Blob) || !('name' in file) || typeof file.name !== 'string' || !file.size) {
            throw new Error('A selected photo could not be read. Remove it and select it again; coverage has not been saved.')
        }
        return file as Blob & { name: string }
    })
}

export async function uploadCoveragePhotos(storage: FirebaseStorage, appointmentId: string, items: unknown): Promise<string[]> {
    const files = coveragePhotoFiles(items)
    if (!appointmentId) throw new Error('Select a session before uploading photos.')
    const byFile = uploads.get(storage) || new WeakMap<Blob, Map<string, Promise<string>>>()
    uploads.set(storage, byFile)
    return Promise.all(files.map(file => {
        const byAppointment = byFile.get(file) || new Map<string, Promise<string>>()
        byFile.set(file, byAppointment)
        let pending = byAppointment.get(appointmentId)
        if (!pending) {
            const fileRef = ref(storage, `appointments/${appointmentId}/coverage-photos/${crypto.randomUUID()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
            pending = (async () => {
                await uploadBytes(fileRef, file)
                const url = await getDownloadURL(fileRef)
                if (!/^https?:\/\//i.test(url)) throw new Error('No downloadable photo URL was returned.')
                return url
            })().catch(() => {
                byAppointment.delete(appointmentId)
                throw new Error(`Could not upload photo "${file.name}". Coverage has not been saved. Check your connection and retry.`)
            })
            byAppointment.set(appointmentId, pending)
        }
        return pending
    }))
}

export function assertCoveragePhotosSaved(expected: string[], actual: unknown, removed: string[] = []): void {
    if (!expected.length && !removed.length) return
    if (!Array.isArray(actual) || expected.some(url => !actual.includes(url)) || removed.some(url => actual.includes(url))) {
        throw new Error('The session save returned, but its photo links could not be verified. Keep this window open and retry saving; do not select the photos again.')
    }
}
