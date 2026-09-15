import { useEffect } from 'react'
import { Modal } from 'antd'
import { Timestamp } from 'firebase/firestore'
import type { GroupId, GroupMeta, QA } from './types'
import {
    financialManagement,
    labourHSE,
    legal,
    marketLinkage,
    marketingCommunication,
    psychometric,
    qualityManagement,
    trainingNeedsYN,
    wellness
} from './questionBanks'

export const asQAArray = (arr?: any[]): QA[] =>
    Array.isArray(arr)
        ? arr.map(x => ({
            answer: x?.answer ?? '',
            comment: x?.comment ?? ''
        }))
        : []

export const stripUndefinedDeep = (val: any): any => {
    if (Array.isArray(val))
        return val.map(stripUndefinedDeep).filter(v => v !== undefined)
    if (val && typeof val === 'object') {
        const out: any = {}
        Object.keys(val).forEach(k => {
            const v = stripUndefinedDeep(val[k])
            if (v !== undefined) out[k] = v
        })
        return out
    }
    return val === undefined ? undefined : val
}

/* ──────────────────────────────────────────────────────────────
  blocks in-app route changes with a modal
────────────────────────────────────────────────────────────── */
export function useLeaveConfirmGuard(when: boolean, message: string) {
    useEffect(() => {
        if (!when) return

        // 1) Hard exits (refresh / close tab)
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = '' // required for Chrome
        }
        window.addEventListener('beforeunload', handleBeforeUnload)

        // 2) Browser back/forward
        // Push a dummy state so the first Back hits our popstate handler
        const pushState = () => window.history.pushState({ __guard__: true }, '')
        pushState()
        const onPopState = () => {
            // Show confirm; if user cancels, re-push to stay on page
            Modal.confirm({
                title: 'Leave this page?',
                content: message,
                okText: 'Leave',
                cancelText: 'Stay',
                onOk: () => {
                    // allow the back navigation by removing listeners then going back one more time
                    cleanup()
                    window.history.back()
                },
                onCancel: () => {
                    // put them back on current page
                    pushState()
                }
            })
        }
        window.addEventListener('popstate', onPopState)

        // 3) In-app link clicks (<Link> renders <a>) — capture phase catches everything
        const onDocClick = (ev: MouseEvent) => {
            if (!when) return
            // ignore modified clicks/new-tab etc.
            if (
                ev.defaultPrevented ||
                ev.button !== 0 ||
                ev.metaKey ||
                ev.ctrlKey ||
                ev.shiftKey ||
                ev.altKey
            )
                return

            // find nearest anchor
            const path = ev.composedPath?.() ?? []
            const anchor =
                (path.find(
                    n => (n as HTMLElement)?.tagName === 'A'
                ) as HTMLAnchorElement) || (ev.target as HTMLElement)?.closest?.('a')
            if (!anchor) return

            const href = anchor.getAttribute('href')
            if (
                !href ||
                href.startsWith('#') ||
                href.startsWith('mailto:') ||
                href.startsWith('tel:')
            )
                return

            // same-origin only (in-app nav)
            const url = new URL(href, window.location.href)
            if (url.origin !== window.location.origin) return

            // At this point, block and ask
            ev.preventDefault()
            Modal.confirm({
                title: 'Leave this page?',
                content: message,
                okText: 'Leave',
                cancelText: 'Stay',
                onOk: () => {
                    cleanup()
                    // navigate by setting location (works with any router)
                    window.location.href = url.href
                }
            })
        }
        document.addEventListener('click', onDocClick, true) // capture!

        // helper to remove listeners
        const cleanup = () => {
            window.removeEventListener('beforeunload', handleBeforeUnload)
            window.removeEventListener('popstate', onPopState)
            document.removeEventListener('click', onDocClick, true)
        }

        return cleanup
    }, [when, message])
}

/* ──────────────────────────────────────────────────────────────
   Question-group metadata — drives step validation and the
   review screen's per-section summaries/edit links.
────────────────────────────────────────────────────────────── */
export const GROUP_META: GroupMeta[] = [
    {
        id: 'marketingCommunication',
        title: 'Marketing & Communication',
        step: 0,
        questionCount: marketingCommunication.length
    },
    {
        id: 'psychometric',
        title: 'Psychometric Evaluation',
        step: 0,
        questionCount: psychometric.length
    },
    {
        id: 'financialManagement',
        title: 'SMME Financial Management',
        step: 1,
        questionCount: financialManagement.length
    },
    {
        id: 'labourHSE',
        title: 'Labour / HSE Compliance',
        step: 1,
        questionCount: labourHSE.length
    },
    {
        id: 'wellness',
        title: 'SMME Wellness',
        step: 2,
        questionCount: wellness.length
    },
    {
        id: 'legal',
        title: 'SMME Legal',
        step: 2,
        questionCount: legal.length
    },
    {
        id: 'marketLinkage',
        title: 'Market Linkage',
        step: 3,
        questionCount: marketLinkage.length
    },
    {
        id: 'qualityManagement',
        title: 'SMME Quality Management',
        step: 3,
        questionCount: qualityManagement.length
    },
    {
        id: 'trainingNeeds',
        title: 'SMME Training Needs',
        step: 4,
        questionCount: trainingNeedsYN.length
    }
]

export const groupMetaById = (id: GroupId): GroupMeta =>
    GROUP_META.find(group => group.id === id) as GroupMeta

/* ──────────────────────────────────────────────────────────────
   Per-step required field paths (mirrors the antd Form.Item
   `name` paths the question banks are rendered with) — used to
   gate each step's Continue button.
────────────────────────────────────────────────────────────── */
const pathsFor = (baseKey: string, count: number): (string | number)[][] => {
    const base = baseKey.split('.')
    return Array.from({ length: count }, (_, i) => [...base, i, 'answer'])
}

export const REQUIRED_PATHS_BY_STEP: (string | number)[][][] = [
    [
        ...pathsFor('marketingCommunication', marketingCommunication.length),
        ...pathsFor('psychometric', psychometric.length)
    ],
    [
        ...pathsFor('financialManagement.q', financialManagement.length),
        ...pathsFor('labourHSE', labourHSE.length)
    ],
    [
        ...pathsFor('wellness.q', wellness.length),
        ...pathsFor('legal.q', legal.length)
    ],
    [
        ...pathsFor('marketLinkage', marketLinkage.length),
        ...pathsFor('qualityManagement', qualityManagement.length)
    ],
    [...pathsFor('trainingNeeds.yn', trainingNeedsYN.length)],
    []
]

export function isStepComplete(stepIndex: number, values: any): boolean {
    const paths = REQUIRED_PATHS_BY_STEP[stepIndex] || []
    return paths.every(path => {
        const v = path.reduce(
            (acc: any, key) => (acc == null ? undefined : acc[key as any]),
            values
        )
        return v === 'Yes' || v === 'No'
    })
}

/* ──────────────────────────────────────────────────────────────
   Submit payload — cut from the original handleFinish verbatim,
   just parameterised instead of closing over component state.
────────────────────────────────────────────────────────────── */
export type GapPayloadContext = {
    participantId: string
    submittedAt: Timestamp
    selectedApplicationId?: string
    programId?: string
    userName?: string
    smmeSignatureUrl: string
    appCryptoSignature: string
}

export function buildGapAnalysisPayload(values: any, ctx: GapPayloadContext) {
    const rawBank = values.financialManagement?.bankAccess || {}
    const bankAccess = (
        rawBank.username ? { username: rawBank.username } : {}
    ) as any
    if (rawBank.password) bankAccess.password = rawBank.password

    const payload = {
        participantId: ctx.participantId,
        ...(ctx.selectedApplicationId ? { applicationId: ctx.selectedApplicationId } : {}),
        ...(ctx.programId ? { programId: ctx.programId } : {}),
        formVersion: 'LEP-MOG QMS 087 F (Rev 01) – Effective 17 July 2025',
        company: {
            name: values.company?.name || '',
            region: values.company?.region || '',
            contact: values.company?.contact || '',
            email: values.company?.email || '',
            dateOfEngagement: ctx.submittedAt
        },
        sections: {
            marketingCommunication: asQAArray(values.marketingCommunication),
            psychometric: asQAArray(values.psychometric),
            financialManagement: {
                q: asQAArray(values.financialManagement?.q),
                ...(Object.keys(bankAccess).length ? { bankAccess } : {})
            },
            labourHSE: asQAArray(values.labourHSE),
            wellness: {
                q: asQAArray(values.wellness?.q),
                programmes: Array.isArray(values.wellness?.programmes)
                    ? values.wellness.programmes
                    : []
            },
            legal: {
                q: asQAArray(values.legal?.q),
                areas: Array.isArray(values.legal?.areas) ? values.legal.areas : []
            },
            marketLinkage: asQAArray(values.marketLinkage),
            qualityManagement: asQAArray(values.qualityManagement),
            trainingNeeds: {
                yn: asQAArray(values.trainingNeeds?.yn),
                setaName: values.trainingNeeds?.setaName || '',
                categories: {
                    management: values.trainingNeeds?.categories?.management || '',
                    supervisors: values.trainingNeeds?.categories?.supervisors || '',
                    workforce: values.trainingNeeds?.categories?.workforce || '',
                    support: values.trainingNeeds?.categories?.support || ''
                }
            }
        },
        signatures: {
            smmeNameSurname: ctx.userName || '',
            smmeSignatureUrl: ctx.smmeSignatureUrl,
            smmeCryptoSignature: ctx.appCryptoSignature || ''
        },
        submittedAt: ctx.submittedAt
    }

    return stripUndefinedDeep(payload)
}
