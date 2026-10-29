import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import {
    APPLICATION_DATABASE_HEADERS,
    APPLICATION_DATABASE_WIDTHS,
    applicationDatabaseRow,
    applicationDatabaseSheet,
    type ApplicationDatabaseSheet
} from '@/utils/applicationExport'
import { loadParticipant, type Application } from './applicationData'

/**
 * Writes the applications database workbook for the given applications. Uses
 * the same participant lookup as the detail view (participantId first, then a
 * unique email match), so both always describe the same person.
 */
export const exportApplicationsWorkbook = async (applications: Application[]) => {
    const cache = new Map<string, Promise<Record<string, any> | null>>()
    const participantFor = (app: Application) => {
        const key = String(app.participantId || '').trim() || `email:${String(app.email || '').toLowerCase()}`
        if (!cache.has(key)) cache.set(key, loadParticipant(app))
        return cache.get(key)!
    }

    const sheets: Record<ApplicationDatabaseSheet, Record<string, string>[]> = {
        Participants: [],
        'Group B': [],
        'Non - active': []
    }
    // Batches of 20 keep large exports quick without flooding Firestore.
    const participants: (Record<string, any> | null)[] = []
    for (let i = 0; i < applications.length; i += 20) {
        participants.push(...(await Promise.all(applications.slice(i, i + 20).map(participantFor))))
    }
    applications.forEach((app, i) => {
        const p = participants[i] || {}
        sheets[applicationDatabaseSheet(app, p)].push(applicationDatabaseRow(app, p))
    })

    const workbook = XLSX.utils.book_new()
    ;(Object.keys(sheets) as ApplicationDatabaseSheet[]).forEach(name => {
        // The header option keeps the template's columns (and an empty sheet's header row) in order.
        const sheet = XLSX.utils.json_to_sheet(sheets[name], { header: APPLICATION_DATABASE_HEADERS })
        sheet['!cols'] = APPLICATION_DATABASE_WIDTHS.map(wch => ({ wch }))
        XLSX.utils.book_append_sheet(workbook, sheet, name)
    })
    XLSX.writeFile(workbook, `APPLICATIONS_DATABASE_${dayjs().format('MMMM_YYYY')}.xlsx`)
}
