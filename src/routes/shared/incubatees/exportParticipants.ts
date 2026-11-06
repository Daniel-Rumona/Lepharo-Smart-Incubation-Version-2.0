import { message } from 'antd'
import { collection, getDocs, query, where } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { db } from '@/firebase'
import { getSMEInterventionSummary } from '@/services/diagnosticPlanService'
import { CompletedInterventionExportRow, SmeRow, addSheet, buildDetailsSheetRows, buildSafeFileName, departmentsMatch, formatDateTime, getAssignedCompletedAt, isStrictlyCompleted, titlesMatch } from './participantsData'

/** Planned interventions for an SME that have a matching, strictly completed assignment. */
export const getCompletedInterventionsForSme = async (row: SmeRow): Promise<CompletedInterventionExportRow[]> => {
    if (!row.participantId) return []

    const [summary, assignedSnap] = await Promise.all([
        getSMEInterventionSummary({
            participantId: row.participantId,
            programId: row.programId
        }),
        getDocs(
            query(
                collection(db, 'assignedInterventions'),
                where('participantId', '==', row.participantId)
            )
        )
    ])

    const plannedInterventions = summary.departments.flatMap(dept => dept.interventions)

    const assignedRows = assignedSnap.docs.map(d => ({
        id: d.id,
        ...(d.data() as any)
    }))

    const completedAssigned = assignedRows.filter(isStrictlyCompleted)

    return plannedInterventions.flatMap(planned => {
        const match = completedAssigned.find(assigned => {
            return (
                titlesMatch(
                    planned.interventionTitle,
                    assigned.interventionTitle || assigned.title || assigned.name
                ) &&
                departmentsMatch(planned, assigned)
            )
        })

        if (!match) return []

        return [
            {
                Beneficiary: planned.beneficiaryName || row.companyName || '—',
                Department: planned.departmentName || match.departmentName || '—',
                Intervention: planned.interventionTitle || match.interventionTitle || '—',
                CompletedAt: formatDateTime(getAssignedCompletedAt(match)),
                DeliveryMethod:
                    match.deliveryMethod ||
                    (Array.isArray(match.deliveryMethods) ? match.deliveryMethods.join(', ') : '') ||
                    match.method ||
                    '—'
            }
        ]
    })
}

/** Downloads one SME's details and completed interventions as an Excel workbook. */
export const exportSingleSme = async (row: SmeRow) => {
    try {
        const workbook = XLSX.utils.book_new()

        addSheet(
            workbook,
            'SME Details',
            buildDetailsSheetRows([row]),
            [16, 28, 14, 22, 22, 20, 14, 18, 28, 28, 18, 32, 16, 24, 16, 18, 18, 16, 18, 16, 18]
        )

        const completedRows = await getCompletedInterventionsForSme(row)

        addSheet(
            workbook,
            'Completed Interventions',
            completedRows,
            [28, 28, 24, 34, 40, 18, 22, 24, 20]
        )

        XLSX.writeFile(workbook, `${buildSafeFileName(`${row.companyName || 'SME'}_details`)}.xlsx`)
    } catch (err) {
        console.error(err)
        message.error('Failed to export SME workbook.')
    }
}

/** Downloads the given (filtered) SMEs and their completed interventions as one Excel workbook. */
export const exportAllSmes = async (filteredRows: SmeRow[]) => {
    try {
        if (!filteredRows.length) {
            message.warning('No SMEs available to export.')
            return
        }

        const workbook = XLSX.utils.book_new()

        addSheet(
            workbook,
            'SME Details',
            buildDetailsSheetRows(filteredRows),
            [16, 18, 28, 14, 22, 22, 20, 14, 18, 28, 28, 18, 32, 16, 24, 16, 18, 18, 16])

        const completedNested = await Promise.all(
            filteredRows.map(row => getCompletedInterventionsForSme(row))
        )

        const allCompletedRows = completedNested.flat()

        addSheet(
            workbook,
            'Completed Interventions',
            allCompletedRows,
            [28, 28, 24, 34, 40, 18, 22, 24, 20]
        )

        XLSX.writeFile(workbook, `${buildSafeFileName('SME_overview_export')}.xlsx`)
    } catch (err) {
        console.error(err)
        message.error('Failed to export SME overview workbook.')
    }
}
