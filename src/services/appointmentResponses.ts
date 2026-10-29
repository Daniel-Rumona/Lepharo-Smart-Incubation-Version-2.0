import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { acceptAssignedIntervention, declineAssignedIntervention } from '@/lib/interventions'

/**
 * An SME's answer to an appointment invite, shared by the dashboard and the
 * "Waiting for you" prompt so both record it the same way.
 */
type AppointmentRef = { id: string; assignedInterventionId?: string | null }

/**
 * Confirms the appointment (optionally with meal/drink choices). Answering an
 * appointment doubles as accepting its intervention assignment when that is still
 * awaiting the SME; when it is not (already accepted, or a later appointment in the
 * same intervention) the accept throws and is safely ignored.
 */
export const confirmAppointmentResponse = async (
    appointment: AppointmentRef,
    foodSelections?: Array<{ menuItemId: string; quantity: number }>
) => {
    await updateDoc(doc(db, 'appointments', appointment.id), {
        ...(foodSelections ? { foodSelections } : {}),
        smeConfirmation: 'confirmed',
        updatedAt: serverTimestamp()
    })
    const assignedInterventionId = String(appointment.assignedInterventionId || '').trim()
    if (assignedInterventionId) {
        try {
            await acceptAssignedIntervention(db, assignedInterventionId)
        } catch {
            // Not awaiting acceptance - nothing to do.
        }
    }
}

/**
 * Declines the appointment with a reason and, optionally, proposed new times.
 * Declining an appointment still awaiting the SME's first answer declines the
 * assignment too; otherwise that throws and is ignored.
 */
export const declineAppointmentResponse = async (
    appointment: AppointmentRef,
    reason: { code: string; text: string },
    proposals: unknown[] = []
) => {
    await updateDoc(doc(db, 'appointments', appointment.id), {
        smeConfirmation: 'declined',
        smeDeclineReason: reason.text,
        smeRescheduleRequest: proposals.length
            ? { status: 'proposed', reasonCode: reason.code, reasonText: reason.text, proposals }
            : null,
        updatedAt: serverTimestamp()
    })
    const assignedInterventionId = String(appointment.assignedInterventionId || '').trim()
    if (assignedInterventionId) {
        try {
            await declineAssignedIntervention(db, assignedInterventionId, reason.text)
        } catch {
            // Not awaiting acceptance - nothing to do.
        }
    }
}
