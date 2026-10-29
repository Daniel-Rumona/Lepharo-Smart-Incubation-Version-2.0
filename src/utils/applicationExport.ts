type ExportRecord = Record<string, any>

const firstValue = (...values: unknown[]): string => {
    for (const raw of values) {
        // Ward and hub are sometimes stored as a list; the first entry is the one shown elsewhere.
        const value = Array.isArray(raw) ? raw.find(item => String(item ?? '').trim()) : raw
        if (value == null) continue
        const text = String(value).trim()
        if (text && text.toLowerCase() !== 'n/a') return text
    }
    return ''
}

const percentText = (...values: unknown[]): string => {
    const text = firstValue(...values)
    if (!text) return ''
    return text.includes('%') ? text : `${text}%`
}

export const applicationDirectorName = (record: ExportRecord): string =>
    firstValue(record.directorName, record.participantName, record.applicantName)

// Columns of the "SRMCDT DATABASE" workbook, in the same order on every sheet.
export const APPLICATION_DATABASE_HEADERS = [
    'Company Name',
    'Director(s)',
    'Ward Number',
    'Core Functional Area (Nature of Business)',
    'Sector',
    'Contact Details',
    'Email Address',
    'Black Owned',
    'Women Owned',
    'Youth Owned',
    'Company Registration Number',
    'BBBEE Level',
    'Physical/Business Address'
]

export const APPLICATION_DATABASE_WIDTHS = [41, 36, 31, 64, 48, 20, 48, 16, 16, 16, 34, 16, 70]

export type ApplicationDatabaseSheet = 'Participants' | 'Group B' | 'Non - active'

// Rejected applications go to "Non - active", those in Group B to "Group B", and everything
// else to "Participants", so no exported application is left out.
export const applicationDatabaseSheet = (app: ExportRecord, participant: ExportRecord = {}): ApplicationDatabaseSheet => {
    if (String(app.applicationStatus || '').toLowerCase() === 'rejected') return 'Non - active'
    const group = firstValue(app.gapGroup, participant.gapGroup).toUpperCase()
    return group === 'B' ? 'Group B' : 'Participants'
}

export const applicationDatabaseRow = (app: ExportRecord, participant: ExportRecord = {}): Record<string, string> => ({
    'Company Name': firstValue(app.beneficiaryName, app.companyName, participant.beneficiaryName, participant.companyName),
    'Director(s)': firstValue(applicationDirectorName(app), applicationDirectorName(participant)),
    'Ward Number': firstValue(app.ward, app.hub, app._location?.hub, participant.ward, participant.hub),
    'Core Functional Area (Nature of Business)': firstValue(app.natureOfBusiness, participant.natureOfBusiness),
    Sector: firstValue(app.sector, participant.sector),
    'Contact Details': firstValue(app.phone, app.mobile, app.whatsapp, participant.phone, participant.mobile, participant.whatsapp),
    'Email Address': firstValue(app.email, app.participantEmail, participant.email, participant.participantEmail),
    'Black Owned': percentText(participant.blackOwnedPercent, app.blackOwnedPercent),
    'Women Owned': percentText(participant.femaleOwnedPercent, app.femaleOwnedPercent),
    'Youth Owned': percentText(participant.youthOwnedPercent, app.youthOwnedPercent),
    'Company Registration Number': firstValue(participant.registrationNumber, app.registrationNumber),
    'BBBEE Level': firstValue(app.beeLevel, app.bbeeeLevel, participant.beeLevel, participant.bbeeeLevel),
    'Physical/Business Address': firstValue(
        participant.businessAddress, app.businessAddress, app.tradingAddress, app.physicalAddress, app.addressLine1
    )
})
