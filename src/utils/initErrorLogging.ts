import { logSystemError } from './logSystemError'

export const initErrorLogging = () => {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    logSystemError(event.error || event.message, {
      severity: 'fatal',
      page: 'global',
      action: 'window.error',
      dedupe: true,
      meta: { filename: event.filename, lineno: event.lineno, colno: event.colno }
    })
  })

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    logSystemError(event.reason, {
      severity: 'fatal',
      page: 'global',
      action: 'unhandledrejection',
      dedupe: true
    })
  })
}
