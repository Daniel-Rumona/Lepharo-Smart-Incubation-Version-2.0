import { guideTarget, type PageGuideRegistration } from '@/components/guide-me'

/** Guided tours for the SME Overview page; every step targets a data-guide attribute on the page. */
export const SME_OVERVIEW_GUIDES: PageGuideRegistration = {
    pageId: 'sme-overview',
    pageTitle: 'SME Overview',
    guides: [
        {
            id: 'sme-overview-quick-tour',
            title: 'Quick tour',
            description:
                'Understand the SME summary, filters, SME list and selected SME workspace.',
            kind: 'page',
            order: 1,
            steps: [
                {
                    element: guideTarget('sme-overview-metrics'),
                    popover: {
                        title: 'Portfolio summary',
                        description:
                            'These metrics respond to the active filters and summarise SMEs in view, reported revenue, current employees and active interventions.',
                        side: 'bottom',
                        align: 'start'
                    }
                },
                {
                    element: guideTarget('sme-overview-filters'),
                    popover: {
                        title: 'Filters and reporting period',
                        description:
                            'Search and filter the SME portfolio, and choose the monthly reporting range used by performance and intervention trends.',
                        side: 'bottom',
                        align: 'start'
                    }
                },
                {
                    element: guideTarget('sme-overview-list'),
                    popover: {
                        title: 'SME list',
                        description:
                            'Select an SME here to load its details into the workspace on the right.',
                        side: 'right',
                        align: 'start'
                    }
                },
                {
                    element: guideTarget('sme-detail-workspace'),
                    popover: {
                        title: 'Selected SME workspace',
                        description:
                            'The selected SME remains in context while you move between Demographics, Performance, Interventions and Compliance.',
                        side: 'left',
                        align: 'start'
                    }
                },
                {
                    element: guideTarget('sme-detail-tabs'),
                    popover: {
                        title: 'SME sections',
                        description:
                            'Use these sections to review profile information, business performance, assigned interventions and compliance.',
                        side: 'bottom',
                        align: 'end'
                    }
                },
                {
                    element: guideTarget('sme-export-all'),
                    popover: {
                        title: 'Export SMEs',
                        description:
                            'Export the currently filtered SMEs to Excel, including SME details and completed interventions.',
                        side: 'bottom',
                        align: 'end'
                    }
                }
            ]
        },
        {
            id: 'sme-review-profile',
            title: 'Review an SME',
            description:
                'Select an SME and review its profile and onboarding information.',
            kind: 'task',
            order: 2,
            steps: [
                {
                    element: '[data-guide="sme-list-card"]',
                    waitForElement: 1500,
                    advanceOnClick: true,
                    skipMissingElement: true,
                    popover: {
                        title: 'Select an SME',
                        description:
                            'Choose an SME from the list to make it the active record.',
                        side: 'right',
                        align: 'center',
                        showButtons: ['close']
                    }
                },
                {
                    element: guideTarget('sme-demographics-tab'),
                    waitForElement: 1500,
                    advanceOnClick: true,
                    popover: {
                        title: 'Demographics',
                        description:
                            'Open the profile section for the selected SME.',
                        side: 'bottom',
                        align: 'center',
                        showButtons: ['close']
                    }
                },
                {
                    element: guideTarget('sme-demographics-content'),
                    waitForElement: 5000,
                    popover: {
                        title: 'SME profile',
                        description:
                            'Review registration, sector, onboarding dates, contact information, branch and ownership information.',
                        side: 'left',
                        align: 'start'
                    }
                },
                {
                    element: '[data-guide="sme-export-one"]',
                    waitForElement: 1500,
                    skipMissingElement: true,
                    popover: {
                        title: 'Export this SME',
                        description:
                            'Download an Excel workbook for one SME when you only need that business and its completed interventions.',
                        side: 'left',
                        align: 'center'
                    }
                }
            ]
        },
        {
            id: 'sme-performance-guide',
            title: 'Review performance',
            description:
                'Review revenue and employment performance for the selected SME.',
            kind: 'task',
            order: 3,
            steps: [
                {
                    element: guideTarget('sme-performance-tab'),
                    advanceOnClick: true,
                    popover: {
                        title: 'Performance',
                        description:
                            'Open Performance to review reported revenue and employment activity.',
                        side: 'bottom',
                        align: 'center',
                        showButtons: ['close']
                    }
                },
                {
                    element: guideTarget('sme-performance-content'),
                    waitForElement: 5000,
                    popover: {
                        title: 'Performance summary',
                        description:
                            'Review cumulative reported revenue, latest headcount and the month-on-month business trend for the selected reporting period.',
                        side: 'left',
                        align: 'start'
                    }
                },
                {
                    element: guideTarget('sme-performance-chart'),
                    waitForElement: 5000,
                    skipMissingElement: true,
                    popover: {
                        title: 'Revenue and employment trend',
                        description:
                            'Compare monthly revenue with reported employees and verified active jobs. The source tags show where each series comes from.',
                        side: 'top',
                        align: 'start'
                    }
                }
            ]
        },
        {
            id: 'sme-interventions-guide',
            title: 'Review interventions',
            description:
                'Review intervention progress and department coverage for the selected SME.',
            kind: 'task',
            order: 4,
            steps: [
                {
                    element: guideTarget('sme-interventions-tab'),
                    advanceOnClick: true,
                    popover: {
                        title: 'Interventions',
                        description:
                            'Open Interventions to see allocated work and delivery progress.',
                        side: 'bottom',
                        align: 'center',
                        showButtons: ['close']
                    }
                },
                {
                    element: guideTarget('sme-interventions-content'),
                    waitForElement: 5000,
                    skipMissingElement: true,
                    popover: {
                        title: 'Intervention summary',
                        description:
                            'See completed, in-progress and not-started intervention counts for this SME. Click a status to filter the departments and interventions below.',
                        side: 'left',
                        align: 'start'
                    }
                },
                {
                    element: guideTarget('sme-intervention-trends'),
                    waitForElement: 1500,
                    skipMissingElement: true,
                    popover: {
                        title: 'Intervention trends',
                        description:
                            'Review assigned versus completed activity over time and the current assignment position by department.',
                        side: 'top',
                        align: 'start'
                    }
                },
                {
                    element: guideTarget('sme-interventions-table'),
                    waitForElement: 1500,
                    skipMissingElement: true,
                    popover: {
                        title: 'Assigned interventions',
                        description:
                            'Pick a department to drill into its interventions and review titles, dates, assignee and current status.',
                        side: 'top',
                        align: 'start'
                    }
                }
            ]
        },
        {
            id: 'sme-compliance-guide',
            title: 'Review compliance',
            description:
                'Review compliance status, signed agreements and supporting documents for the selected SME.',
            kind: 'task',
            order: 5,
            steps: [
                {
                    element: guideTarget('sme-compliance-tab'),
                    advanceOnClick: true,
                    popover: {
                        title: 'Compliance',
                        description:
                            'Open Compliance to review documents and signed agreements for the selected SME.',
                        side: 'bottom',
                        align: 'center',
                        showButtons: ['close']
                    }
                },
                {
                    element: guideTarget('sme-compliance-content'),
                    waitForElement: 5000,
                    skipMissingElement: true,
                    popover: {
                        title: 'Compliance status',
                        description:
                            'Review valid, expired and attention-required compliance records. An empty state is shown when nothing has been captured yet.',
                        side: 'left',
                        align: 'start'
                    }
                },
                {
                    element: '[data-guide="sme-manage-compliance"]',
                    waitForElement: 1200,
                    skipMissingElement: true,
                    popover: {
                        title: 'Manage Compliance',
                        description:
                            'Users with onboarding access can continue to the compliance workspace to manage the SME’s requirements.',
                        side: 'left',
                        align: 'center'
                    }
                },
                {
                    element: guideTarget('sme-compliance-documents'),
                    waitForElement: 1500,
                    skipMissingElement: true,
                    popover: {
                        title: 'Documents and agreements',
                        description:
                            'Open available uploads or generated agreement viewers and review signing or expiry information for each record.',
                        side: 'top',
                        align: 'start'
                    }
                }
            ]
        },
        {
            id: 'sme-add-guide',
            title: 'Add an SME',
            description:
                'Start a new SME record for the currently selected programme.',
            kind: 'task',
            order: 6,
            steps: [
                {
                    element: guideTarget('sme-add-action'),
                    waitForElement: 1500,
                    skipMissingElement: true,
                    popover: {
                        title: 'Add SME',
                        description:
                            'When onboarding access is available and a specific programme is selected, use this action to start a new SME record.',
                        side: 'bottom',
                        align: 'end'
                    }
                }
            ]
        }
    ]
}
