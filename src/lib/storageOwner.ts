import type { UploadMetadata } from 'firebase/storage'
import { auth } from '@/firebase'

/**
 * Who a stored file belongs to, kept on the file itself as custom metadata so
 * the system admin's Storage page (functions/src/storageBrowser.ts) can name
 * the owner of files whose path carries no id, e.g. participant_documents/.
 */
export type UploadOwner = {
    /** The SME the file is for, when there is one. */
    participantId?: string | null
    applicationId?: string | null
    /** A person other than the uploader the file belongs to. */
    ownerUid?: string | null
}

/** Adds uploadedBy (the signed-in user) and any owner ids to an upload's metadata. */
export const withOwner = (metadata: UploadMetadata = {}, owner: UploadOwner = {}): UploadMetadata => {
    const tags: Record<string, string> = {}
    const uid = auth.currentUser?.uid
    if (uid) tags.uploadedBy = uid
    if (owner.ownerUid) tags.ownerUid = owner.ownerUid
    if (owner.participantId) tags.participantId = owner.participantId
    if (owner.applicationId) tags.applicationId = owner.applicationId
    return { ...metadata, customMetadata: { ...tags, ...(metadata.customMetadata || {}) } }
}
