/**
 * On phones modals open as bottom drawers (see index.css), and the drawer
 * already has a close (X) in its corner, so its own Cancel / Close footer
 * button is redundant. This marks those buttons so index.css can hide them
 * on small screens and give the remaining action the full row.
 *
 * It is label based on purpose: there are well over a hundred modals, most
 * with hand-built footers, so there is no single place to switch this off.
 * A modal is only touched when it still has its X, so nothing is left
 * without a way to close.
 */
const CANCEL_LABELS = new Set(['cancel', 'close', 'dismiss'])
const MOBILE_QUERY = '(max-width: 767px)'

const markCancelButtons = () => {
    document.querySelectorAll<HTMLElement>('.ant-modal').forEach(modal => {
        if (!modal.querySelector('.ant-modal-close')) return

        modal.querySelectorAll<HTMLElement>('.ant-btn').forEach(button => {
            if (button.classList.contains('ant-modal-close')) return
            const label = (button.textContent || '').trim().toLowerCase()
            if (CANCEL_LABELS.has(label)) button.classList.add('drawer-cancel')
        })
    })
}

export const startMobileDrawerFooters = () => {
    if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return

    const media = window.matchMedia(MOBILE_QUERY)
    let scheduled = false

    const schedule = () => {
        if (scheduled || !media.matches) return
        scheduled = true
        requestAnimationFrame(() => {
            scheduled = false
            markCancelButtons()
        })
    }

    // Modals mount into document.body, so watching it covers all of them.
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
}
