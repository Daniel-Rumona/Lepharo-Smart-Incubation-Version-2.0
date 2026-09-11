export type AppointmentRsvp = 'pending' | 'confirmed' | 'declined'
export type AppointmentAttendance = 'attended' | 'partially_attended' | 'no_show' | 'unverified'

export function appointmentMemberStatus(
    rsvp: AppointmentRsvp | string | undefined,
    attendance: AppointmentAttendance,
    meetingHeld: boolean | null
) {
    const response = String(rsvp || 'pending').toLowerCase()
    const attendanceRecorded = attendance !== 'unverified' || meetingHeld !== null
    const rsvpStatus = response === 'confirmed'
        ? { label: 'Confirmed', color: 'success' }
        : response === 'declined'
            ? { label: 'Declined', color: 'error' }
            : attendanceRecorded
                ? { label: 'No RSVP', color: 'warning' }
                : { label: 'Awaiting RSVP', color: 'processing' }

    const attendanceStatus = meetingHeld === false
        ? { label: 'Meeting not held', color: 'default' }
        : attendance === 'attended'
            ? { label: 'Attended', color: 'success' }
            : attendance === 'partially_attended'
                ? { label: 'Partially attended', color: 'cyan' }
                : attendance === 'no_show'
                    ? { label: 'Did not attend', color: 'error' }
                    : meetingHeld === true
                        ? { label: 'Attendance not recorded', color: 'warning' }
                        : { label: 'Not recorded', color: 'default' }

    return { rsvp: rsvpStatus, attendance: attendanceStatus, attendanceRecorded }
}
