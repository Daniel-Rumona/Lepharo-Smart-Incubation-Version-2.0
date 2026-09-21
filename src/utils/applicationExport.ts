type ExportRecord = Record<string, any>

const firstValue = (...values: unknown[]): string => {
    for (const value of values) {
        if (value == null) continue
        const text = String(value).trim()
        if (text && text.toLowerCase() !== 'n/a') return text
    }
    return ''
}

export const applicationDirectorName = (record: ExportRecord): string =>
    firstValue(record.directorName, record.participantName, record.applicantName)

export const applicationExportRow = (app: ExportRecord, participant: ExportRecord = {}): string[] => [
    firstValue(app.beneficiaryName, app.companyName, participant.beneficiaryName, participant.companyName),
    firstValue(applicationDirectorName(app), applicationDirectorName(participant)),
    firstValue(app.sector, participant.sector),
    firstValue(app.natureOfBusiness, participant.natureOfBusiness),
    firstValue(app.gender, participant.gender),
    firstValue(app.idNumber, app.nationalId, participant.idNumber, participant.nationalId),
    firstValue(app.beeLevel, app.bbeeeLevel, participant.beeLevel, participant.bbeeeLevel),
    firstValue(app.email, app.participantEmail, participant.email, participant.participantEmail),
    firstValue(app.phone, app.mobile, app.whatsapp, participant.phone, participant.mobile, participant.whatsapp),
    firstValue(app.ward, participant.ward)
]

export const applicationsCSV = (rows: string[][]): string => {
    const headers = ['Enterprise Name', 'Director Name', 'Sector', 'Nature Of Business', 'Gender', 'Id Number', 'BBBEE Level', 'Email Address', 'Contact Number', 'Ward']
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    return '\uFEFF' + [headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n')
}
