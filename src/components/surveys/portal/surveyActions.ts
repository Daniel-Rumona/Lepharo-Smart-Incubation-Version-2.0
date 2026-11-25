import {
    Timestamp,
    collection,
    deleteDoc,
    doc,
    getDocs,
    limit,
    query,
    updateDoc,
    where,
    writeBatch
} from 'firebase/firestore'
import { db } from '@/firebase'
import { toResponseQuestions, type SurveyField } from './surveyData'

/** Thrown when an action would lose submitted answers or break a sent survey. */
export class SurveyActionBlocked extends Error {}

/**
 * Deletes a template nobody has been sent. Checked against Firestore, not
 * the page's list, which only holds the active programme's surveys.
 */
export const deleteTemplate = async (templateId: string) => {
    const sent = await getDocs(
        query(collection(db, 'sentForms'), where('templateId', '==', templateId), limit(1))
    )
    if (!sent.empty) {
        throw new SurveyActionBlocked('This template has been sent, so archive it instead.')
    }
    await deleteDoc(doc(db, 'formTemplates', templateId))
}

/**
 * Makes a draft template ready to send (status "published"). This never sends
 * anything: it only lets the template be picked in the Send window.
 */
export const makeTemplateReady = (templateId: string) =>
    updateDoc(doc(db, 'formTemplates', templateId), {
        status: 'published',
        updatedAt: new Date().toISOString()
    })

/** Archived templates leave the Templates list and the Send window; sent surveys keep working. */
export const setTemplateArchived = (templateId: string, archived: boolean) =>
    updateDoc(doc(db, 'formTemplates', templateId), {
        archived,
        updatedAt: new Date().toISOString()
    })

/**
 * Deletes a sent survey and every SME's copy in one batch, but only while
 * nobody has submitted. Re-read here so an answer that came in after the
 * page loaded is never lost.
 */
export const deleteSentSurvey = async (sentFormId: string) => {
    const responses = await getDocs(collection(db, 'sentForms', sentFormId, 'responses'))
    if (responses.docs.some(response => response.data().completed === true)) {
        throw new SurveyActionBlocked('Someone has already submitted, so close the survey instead.')
    }
    if (responses.size > 499) {
        throw new SurveyActionBlocked('This survey has too many recipients to delete in one go.')
    }
    const batch = writeBatch(db)
    responses.docs.forEach(response => batch.delete(response.ref))
    batch.delete(doc(db, 'sentForms', sentFormId))
    await batch.commit()
}

/**
 * Gives every SME who hasn't submitted the template's current questions,
 * keeping draft answers to questions that are still there. Submitted copies
 * are never touched: they keep the questions their answers belong to. Read
 * fresh here so an SME who submits meanwhile isn't changed under them.
 */
export const updateSurveyQuestions = async (sentFormId: string, fields: SurveyField[]) => {
    const responses = await getDocs(collection(db, 'sentForms', sentFormId, 'responses'))
    const waiting = responses.docs.filter(response => response.data().completed !== true)
    if (!waiting.length) {
        throw new SurveyActionBlocked('Everyone has already submitted, so there is nobody to update.')
    }
    if (waiting.length > 499) {
        throw new SurveyActionBlocked('This survey has too many SMEs waiting to update in one go.')
    }

    // Undefined is not a firestore value; the JSON round trip drops it.
    const snapshotFields = JSON.parse(JSON.stringify(fields))
    const questions = JSON.parse(JSON.stringify(toResponseQuestions(fields)))
    const keep = new Set(fields.map(field => field.id))

    const batch = writeBatch(db)
    waiting.forEach(response => {
        const draft = (response.data().answersDraft || {}) as Record<string, unknown>
        batch.update(response.ref, {
            fields: snapshotFields,
            questions,
            answersDraft: Object.fromEntries(Object.entries(draft).filter(([id]) => keep.has(id)))
        })
    })
    batch.update(doc(db, 'sentForms', sentFormId), { questionsUpdatedAt: Timestamp.now() })
    await batch.commit()
    return waiting.length
}

/** Stops further answers by moving the due date to now; every answer is kept. */
export const closeSentSurvey = (sentFormId: string) =>
    updateDoc(doc(db, 'sentForms', sentFormId), { dueDate: Timestamp.now() })
