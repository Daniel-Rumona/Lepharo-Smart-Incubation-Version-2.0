import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { App } from 'antd'
import GAPAnalysisForm from '@/routes/gap/new/form'

const GAPAnalysisFormWrapper = () => {
  const { state } = useLocation()
  const navigate = useNavigate()
  const { modal } = App.useApp() // ✅ modern AntD API

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault()
      modal.confirm({
        title: 'Leave this page?',
        content:
          'If you exit before completion your application will not be considered and you would have to resubmit.',
        okText: 'Leave',
        cancelText: 'Stay',
        onOk: () => {
          window.removeEventListener('popstate', handlePopState)
          navigate('/incubatee', { replace: true }) // go back safely
        }
      })
      window.history.pushState(null, '', window.location.href)
    }

    window.addEventListener('popstate', handlePopState)
    window.history.pushState(null, '', window.location.href)

    return () => window.removeEventListener('popstate', handlePopState)
  }, [navigate, modal])

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
