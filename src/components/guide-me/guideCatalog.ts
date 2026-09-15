// Guides the Help Assistant is allowed to offer and link to. This is the
// single source of truth for pageId/guideId pairs — each matching page's own
// usePageGuides() registration must reuse the exact same ids, and the AI
// backend is only ever allowed to return a pageId/guideId pair copied
// verbatim from this list (see ai-backend `_sanitize_guide`).
export type CatalogGuide = {
    pageId: string
    route: string
    pageTitle: string
    guideId: string
    title: string
    description: string
}

export const ASSISTANT_GUIDE_CATALOG: CatalogGuide[] = [
    {
        pageId: 'applicant-dashboard',
        route: '/applicant',
        pageTitle: 'Programs & Apply',
        guideId: 'apply-walkthrough',
        title: 'How to apply to a program',
        description:
            'Browse the open programs and submit an application to one.'
    },
    {
        pageId: 'applicant-submit-inquiry',
        route: '/applicant/submit-inquiry',
        pageTitle: 'Submit an Inquiry',
        guideId: 'submit-inquiry-walkthrough',
        title: 'How to submit an inquiry',
        description:
            'Choose what you need help with and send an inquiry to our team.'
    },
    {
        pageId: 'applicant-inquiries',
        route: '/applicant/inquiries',
        pageTitle: 'My Inquiries',
        guideId: 'inquiries-walkthrough',
        title: 'How to track and manage your inquiries',
        description:
            'Find inquiries you have submitted and follow up on them.'
    },
    {
        pageId: 'applicant-tracker',
        route: '/applicant/tracker',
        pageTitle: 'Application Tracker',
        guideId: 'tracker-walkthrough',
        title: 'How to check your application status',
        description:
            'See where each of your applications stands and what happens next.'
    }
]
