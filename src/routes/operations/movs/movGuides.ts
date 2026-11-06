import { guideTarget, type PageGuideRegistration } from '@/components/guide-me'

/** Guide Me tours for the MOV workspace. */
export const MOV_GUIDES: PageGuideRegistration = {
    pageId: 'mov-approvals',
    pageTitle: 'MOVs',
    guides: [
        {
            id: 'mov-approvals-overview',
            title: 'Quick tour',
            description: 'How the MOV workspace is laid out: MOVs to review, monthly packs and submitting a month.',
            kind: 'page',
            order: 1,
            steps: [
                {
                    element: guideTarget('mov-view-switch'),
                    popover: { title: 'MOVs and monthly packs', description: 'Switch between individual MOVs to review and the monthly packs you have submitted.', side: 'bottom', align: 'start' }
                },
                {
                    element: guideTarget('mov-filter-bar'),
                    popover: { title: 'Find what needs you', description: 'The strip shows how many MOVs are to review, queried or approved. Search, or open Filters for facilitator, due month and date confirmed.', side: 'bottom', align: 'start' }
                },
                {
                    element: guideTarget('mov-main-table'),
                    popover: { title: 'The list', description: 'Pick an MOV to see it on the right. Flags show missing evidence, open queries, the pack it is in and late MOVs.', side: 'right', align: 'start' }
                },
                {
                    element: guideTarget('mov-detail'),
                    skipMissingElement: true,
                    popover: { title: 'The MOV', description: 'Approve or query it here, open its evidence, resolve your queries and read the confirmation sheet.', side: 'left', align: 'start' }
                }
            ]
        },
        {
            id: 'review-mov',
            title: 'Review an MOV',
            description: 'Check the confirmation sheet and evidence, then approve it or raise a query.',
            kind: 'task',
            order: 2,
            steps: [
                {
                    element: '[data-guide="mov-view-action"]',
                    advanceOnClick: true,
                    popover: { title: 'Open an MOV', description: 'Select an MOV in the list.', side: 'right', align: 'center', showButtons: ['close'] }
                },
                {
                    element: guideTarget('mov-document-ready'),
                    waitForElement: 15000,
                    popover: { title: 'Confirmation sheet', description: 'Check the beneficiary, sessions, signatures and other details. Use Full size to read it at print size.', side: 'left', align: 'start' }
                },
                {
                    element: guideTarget('mov-preview-actions'),
                    waitForElement: 5000,
                    popover: { title: 'Decide', description: 'Approve it when it and its evidence are correct; the next MOV to review opens automatically. Query it when something needs fixing.', side: 'bottom', align: 'start' }
                }
            ]
        },
        {
            id: 'raise-mov-query',
            title: 'Raise an MOV query',
            description: 'Send an MOV back to the facilitator with a clear issue to correct.',
            kind: 'task',
            order: 3,
            steps: [
                {
                    element: '[data-guide="mov-query-action"]',
                    advanceOnClick: true,
                    popover: { title: 'Query the MOV', description: 'Select Query on the open MOV.', side: 'bottom', align: 'center', showButtons: ['close'] }
                },
                {
                    element: guideTarget('mov-query-form'),
                    waitForElement: 5000,
                    popover: { title: 'Describe the issue', description: 'Choose the closest issue type and say exactly what the facilitator must correct.', side: 'right', align: 'start' }
                },
                {
                    element: '.guide-raise-query-submit',
                    waitForElement: 5000,
                    popover: { title: 'Send', description: 'The MOV goes back to the facilitator; their answer appears in the MOV’s queries.', side: 'top', align: 'center' }
                }
            ]
        },
        {
            id: 'submit-consolidated-movs',
            title: 'Submit a month',
            description: 'Send a month’s approved MOVs with evidence to the Center Coordinator.',
            kind: 'task',
            order: 4,
            steps: [
                {
                    element: guideTarget('submit-movs-action'),
                    advanceOnClick: true,
                    popover: { title: 'Submit a month', description: 'Open the monthly submission.', side: 'bottom', align: 'end', showButtons: ['close'] }
                },
                {
                    element: guideTarget('submit-movs-month'),
                    waitForElement: 5000,
                    popover: { title: 'Pick the month', description: 'Each month shows how many MOVs are ready. MOVs belong to the month they are due.', side: 'bottom', align: 'start' }
                },
                {
                    element: '.guide-generate-pack-submit',
                    waitForElement: 5000,
                    popover: { title: 'Submit', description: 'Check the MOVs listed, attach the invoice if there is one, and submit.', side: 'top', align: 'end' }
                }
            ]
        },
        {
            id: 'review-consolidated-pack',
            title: 'Follow a monthly pack',
            description: 'See where a pack is (CC, then M&E), what it holds and any queries on it.',
            kind: 'task',
            order: 5,
            steps: [
                {
                    element: guideTarget('consolidated-movs-option'),
                    advanceOnClick: true,
                    popover: { title: 'Monthly packs', description: 'Switch to Monthly packs.', side: 'bottom', align: 'center', showButtons: ['close'] }
                },
                {
                    element: '[data-guide="view-pack-action"]',
                    waitForElement: 3000,
                    advanceOnClick: true,
                    skipMissingElement: true,
                    popover: { title: 'Open a pack', description: 'Select a month.', side: 'right', align: 'center', showButtons: ['close'] }
                },
                {
                    element: guideTarget('mov-pack-detail'),
                    waitForElement: 5000,
                    skipMissingElement: true,
                    popover: { title: 'The pack', description: 'Its stages, invoice, MOVs and M&E queries. Until the CC confirms it you can update it; once verified you can download it.', side: 'left', align: 'start' }
                }
            ]
        }
    ]
}
