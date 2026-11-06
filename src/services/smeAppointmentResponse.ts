import { Timestamp, doc, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { acceptAssignedIntervention, declineAssignedIntervention } from '@/lib/interventions'
import { isPastAppointment } from '@/services/appointmentService'
import {
    appointmentDeclineReasonAllowsTimeProposal,
    buildAppointmentDeclineReason,
    type AppointmentDeclineReasonCode
} from '@/lib/appointmentDeclineReasons'
import {
    buildAppointmentRescheduleProposals,
    type AppointmentProposalDraft
} from '@/components/appointments/AppointmentRescheduleProposalFields'

/**
 * An SME's answer to an appointment invite. The appointments page and the
 * in-place response sheet both write through here, so a response has the same
 * effect wherever it is given.
 */

type AppointmentLike = Record<string, any> & { id: string }

/** True when a decline may carry proposed new times (one-to-one sessions only). */
export const canProposeNewTime = (
    appointment: AppointmentLike | null | undefined,
    reasonCode?: AppointmentDeclineReasonCode
) => appointment?.isGroupAppointment !== true && appointmentDeclineReasonAllowsTimeProposal(reasonCode)

export const confirmAppointmentAsSme = async (appointment: AppointmentLike) => {
    await updateDoc(doc(db, 'appointments', appointment.id), {
        smeConfirmation: 'confirmed',
        updatedAt: Timestamp.now()
    })

    // Responding to an appointment doubles as accepting the underlying
    // intervention assignment when it's still awaiting that decision.
    // A no-op (already accepted, or a later appointment in the same
    // intervention) throws and is safe to ignore here.
    const assignedInterventionId = String(appointment?.assignedInterventionId || '').trim()
    if (assignedInterventionId) {
        try {
            await acceptAssignedIntervention(db, assignedInterventionId)
        } catch {
            // Not awaiting acceptance - nothing to do.
        }
    }
}

/**
 * Declines an appointment with a reason and, where allowed, proposed times.
 * Throws an Error whose message is ready to show when the input is invalid
 * or the appointment has already passed. Resolves with the fields the caller
 * should merge into its local copy of the appointment.
 */
export const declineAppointmentAsSme = async (
    appointment: AppointmentLike,
    input: {
        reasonCode?: AppointmentDeclineReasonCode
        reasonDetails?: string
        proposals: AppointmentProposalDraft[]
    }
) => {
    if (isPastAppointment(appointment as any)) {
        throw new Error('This appointment has passed and can no longer be declined.')
    }

    const reason = buildAppointmentDeclineReason(input.reasonCode, input.reasonDetails || '')
    const rescheduleProposals = canProposeNewTime(appointment, reason.code)
        ? buildAppointmentRescheduleProposals(input.proposals)
        : []
    const rescheduleRequest = rescheduleProposals.length
        ? {
            status: 'proposed',
            reasonCode: reason.code,
            reasonText: reason.text,
            proposals: rescheduleProposals
        }
        : null

    await updateDoc(doc(db, 'appointments', appointment.id), {
        smeConfirmation: 'declined',
        smeDeclineReason: reason.text,
        smeRescheduleRequest: rescheduleRequest,
        updatedAt: Timestamp.now()
    })

    // Declining an appointment that's still awaiting the SME's initial
    // acceptance declines the underlying assignment too. A no-op
    // (already resolved, or a later appointment in the same
    // intervention) throws and is safe to ignore here.
    const assignedInterventionId = String(appointment?.assignedInterventionId || '').trim()
    if (assignedInterventionId) {
        try {
            await declineAssignedIntervention(db, assignedInterventionId, reason.text)
        } catch {
            // Not awaiting acceptance - nothing to do.
        }
    }

    return {
        userConfirmation: 'declined' as const,
        smeConfirmation: 'declined' as const,
        declineReasonCode: reason.code,
        declineReasonLabel: reason.label,
        declineReasonDetails: reason.details,
        declineReason: reason.text,
        userRejectionReason: reason.text,
        rescheduleRequest
    }
}
