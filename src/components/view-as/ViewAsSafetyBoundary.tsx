import React, { useEffect } from 'react'
import { message } from 'antd'
import { useIdentity } from '@/contexts/IdentityContext'

const MUTATING_BUTTON_TEXT = /\b(save|submit|create|add|update|edit|delete|remove|upload|approve|reject|accept|decline|confirm|assign|cancel|send|sign|publish|archive|restore)\b/i

const isViewAsControl = (element: Element) => !!element.closest('[data-view-as-control="true"]')
const isMutatingButton = (element: Element) => {
    if (isViewAsControl(element)) return false
    const label = String(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim()
    return MUTATING_BUTTON_TEXT.test(label) || element.matches('input[type="file"]')
}

export const ViewAsSafetyBoundary: React.FC<React.PropsWithChildren> = ({ children }) => {
    const { isViewingAs } = useIdentity()
    const [messageApi, contextHolder] = message.useMessage()

    useEffect(() => {
        if (!isViewingAs) return
        const warn = () => messageApi.warning('Read-only preview: this action was blocked.')
        const blockSubmit = (event: SubmitEvent) => {
            if (isViewAsControl(event.target as Element)) return
            event.preventDefault()
            event.stopImmediatePropagation()
            warn()
        }
        const blockUnsafeClick = (event: MouseEvent) => {
            const target = event.target as Element | null
            if (!target) return
            const interactive = target.closest('button, [role="button"], input[type="file"]')
            if (!interactive || !isMutatingButton(interactive)) return
            event.preventDefault()
            event.stopImmediatePropagation()
            warn()
        }
        document.addEventListener('submit', blockSubmit, true)
        document.addEventListener('click', blockUnsafeClick, true)
        return () => {
            document.removeEventListener('submit', blockSubmit, true)
            document.removeEventListener('click', blockUnsafeClick, true)
        }
    }, [isViewingAs, messageApi])

    return <>{contextHolder}{children}</>
}
