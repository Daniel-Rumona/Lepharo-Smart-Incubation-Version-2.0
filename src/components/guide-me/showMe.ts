import type { DriveStep } from 'driver.js'
import { guideTarget } from './guideTargets'

export type PageGuideTarget = {
    name: string
    text: string
    kind: string
}

const MAX_TARGETS = 120
const VALID_NAME = /^[A-Za-z0-9_.:-]{1,80}$/

const isVisible = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
}

const visibleText = (element: HTMLElement) => {
    const label =
        element.getAttribute('aria-label') ||
        element.getAttribute('placeholder') ||
        element.getAttribute('title') ||
        element.innerText ||
        ''
    return label.replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** The guide targets on screen right now: the only things an assistant tour may point at. */
export const collectGuideTargets = (): PageGuideTarget[] => {
    const seen = new Set<string>()
    const out: PageGuideTarget[] = []
    document.querySelectorAll<HTMLElement>('[data-guide]').forEach(element => {
        const name = element.dataset.guide || ''
        if (out.length >= MAX_TARGETS || !VALID_NAME.test(name) || seen.has(name)) return
        if (!isVisible(element)) return
        seen.add(name)
        out.push({ name, text: visibleText(element), kind: element.tagName.toLowerCase() })
    })
    return out
}

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

/**
 * Waits for a freshly opened page to settle: its route is showing and the set of guide
 * targets has stopped growing (pages load their data after mounting). Gives up after
 * `timeoutMs` and returns whatever is there.
 */
export const waitForGuideTargets = async (route: string, timeoutMs = 6000) => {
    const started = Date.now()
    let lastCount = -1
    let stableFor = 0
    const path = route.split(/[?#]/)[0]
    while (Date.now() - started < timeoutMs) {
        await sleep(250)
        if (!window.location.pathname.startsWith(path)) continue
        const count = collectGuideTargets().length
        stableFor = count === lastCount && count > 0 ? stableFor + 1 : 0
        lastCount = count
        if (stableFor >= 3) break
    }
    return collectGuideTargets()
}

export type ComposedStep = {
    target: string | null
    title: string
    description: string
}

export const toDriveSteps = (steps: ComposedStep[]): DriveStep[] =>
    steps.map(step => ({
        ...(step.target ? { element: guideTarget(step.target) } : {}),
        popover: { title: step.title, description: step.description }
    }))
