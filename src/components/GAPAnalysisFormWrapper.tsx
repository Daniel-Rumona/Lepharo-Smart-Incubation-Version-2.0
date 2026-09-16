import { useLocation } from 'react-router-dom'
import GAPAnalysisForm from '@/routes/gap/new/form'

const GAPAnalysisFormWrapper = () => {
  const { state } = useLocation()

  // Leave-confirmation (back button, in-app links, refresh/close) is handled
  // by useLeaveConfirmGuard inside GAPAnalysisForm itself — a second guard
  // here fought it for the same popstate event and hijacked "Leave" to
  // always land on /incubatee instead of wherever the SME actually came from.

  if (!state || !state.participantId) {
    return <div>No participant data found.</div>
  }

  return (
    <GAPAnalysisForm
      participantId={state.participantId}
      prefillData={state.prefillData}
      mode='incubatee'
    />
  )
}

export default GAPAnalysisFormWrapper
