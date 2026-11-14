import React from 'react'
import FollowUpsList from '@/routes/receptionist/follow-ups'

/**
 * A department coordinator's escalated inquiry follow-ups: the ones reception
 * handed to their department. The same worklist as reception's, in department
 * mode (close with an outcome, reschedule, or hand back).
 */
const CoordinatorFollowUps: React.FC = () => <FollowUpsList mode='department' />

export default CoordinatorFollowUps
