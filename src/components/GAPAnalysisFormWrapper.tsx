import { useLocation } from 'react-router-dom'
import GAPAnalysisForm from '@/routes/gap/new/form'
import GapAnalysisLanding from '@/routes/incubatee/gap-analysis'

const GAPAnalysisFormWrapper = () => {
  const { state } = useLocation()

  // Leave-confirmation (back button, in-app links, refresh/close) is handled
  // by useLeaveConfirmGuard inside GAPAnalysisForm itself — a second guard
  // here fought it for the same popstate event and hijacked "Leave" to
  // always land on /incubatee instead of wherever the SME actually came from.

  // Opened directly rather than from a flow: show their results, or invite
  // them to start.
  if (!state || !state.participantId) {
    return <GapAnalysisLanding />
  }

  // The form finds the SME's participant record from their email itself.
  return <GAPAnalysisForm />
}

export default GAPAnalysisFormWrapper
