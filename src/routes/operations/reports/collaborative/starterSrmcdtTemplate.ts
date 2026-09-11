import type { TemplateSection } from './types'

const emptyAssignment = {
  editorDepartmentIds: [] as string[],
  editorDepartmentNames: [] as string[],
  editorUserIds: [] as string[],
  editorUserNames: [] as string[]
}

export const SRMCDT_QUARTERLY_STARTER_STRUCTURE: TemplateSection[] = [
  {
    id: 'project-overview',
    title: 'Project Overview',
    order: 1,
    blocks: [
      {
        id: 'project-summary',
        title: 'Project Summary',
        contentType: 'narrative',
        required: true,
        carryPolicy: 'review',
        ...emptyAssignment,
        defaultContent: ''
      }
    ]
  },
  {
    id: 'communication-progress',
    title: 'Section 1: Communication on Progress',
    order: 2,
    blocks: [
      { id: 'milestones', title: 'Milestones Achieved', contentType: 'table', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Activity', 'Date', 'Status', 'Comments'] }, defaultContent: { rows: [] } },
      { id: 'stakeholder-engagement', title: 'Stakeholder Engagement Status', contentType: 'table', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Activity', 'Date', 'Status'] }, defaultContent: { rows: [] } },
      { id: 'project-resourcing', title: 'Project Resourcing', contentType: 'table', required: false, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Activity', 'Date', 'Status'] }, defaultContent: { rows: [] } },
      { id: 'mapping', title: 'Mapping', contentType: 'table', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Activity', 'Date', 'Areas/Wards', 'Team/Resources', 'Duration', 'Status'] }, defaultContent: { rows: [] } },
      { id: 'onboarding', title: 'SMME Onboarding', contentType: 'narrative', required: true, carryPolicy: 'review', ...emptyAssignment, defaultContent: '' },
      { id: 'rom-kpis', title: 'KPI Tracking · ROM / Mapping / Onboarding', contentType: 'kpi', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Indicator', 'Target', 'Achieved', 'Variance', 'Comments', 'Status'] }, defaultContent: { rows: [] } },
      { id: 'pds-kpis', title: 'KPI Tracking · Personal Development and Support', contentType: 'kpi', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Indicator', 'Target', 'Achieved', 'Variance', 'Comments', 'Status'] }, defaultContent: { rows: [] } },
      { id: 'wellness-kpis', title: 'KPI Tracking · Wellness', contentType: 'kpi', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Indicator', 'Target', 'Achieved', 'Variance', 'Comments', 'Status'] }, defaultContent: { rows: [] } },
      { id: 'hse-kpis', title: 'KPI Tracking · HSE and Labour Compliance', contentType: 'kpi', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Indicator', 'Target', 'Achieved', 'Variance', 'Comments', 'Status'] }, defaultContent: { rows: [] } },
      { id: 'legal-kpis', title: 'KPI Tracking · Legal Services', contentType: 'kpi', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Indicator', 'Target', 'Achieved', 'Variance', 'Comments', 'Status'] }, defaultContent: { rows: [] } },
      { id: 'training-kpis', title: 'KPI Tracking · NVC / QMS / Technical Enablement', contentType: 'kpi', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Indicator', 'Target', 'Achieved', 'Variance', 'Comments', 'Status'] }, defaultContent: { rows: [] } },
      { id: 'finance-kpis', title: 'KPI Tracking · Financial Compliance', contentType: 'kpi', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Indicator', 'Target', 'Achieved', 'Variance', 'Comments', 'Status'] }, defaultContent: { rows: [] } },
      { id: 'update-on-progress', title: 'Update on Progress', contentType: 'narrative', required: true, carryPolicy: 'review', ...emptyAssignment, defaultContent: '' }
    ]
  },
  {
    id: 'issues-risks',
    title: 'Section 2: Issues and Risks',
    order: 3,
    blocks: [
      { id: 'problems-encountered', title: 'Problems Encountered', contentType: 'table', required: true, carryPolicy: 'carry', ...emptyAssignment, schema: { columns: ['Challenge', 'Obstacle', 'Risk', 'Reason'] }, defaultContent: { rows: [] } },
      { id: 'risk-assessment', title: 'Risk Assessment', contentType: 'table', required: true, carryPolicy: 'carry', ...emptyAssignment, schema: { columns: ['Risk', 'Potential Impact', 'Mitigation Strategy', 'Outcome'] }, defaultContent: { rows: [] } },
      { id: 'issues-log', title: 'Issues Log', contentType: 'table', required: true, carryPolicy: 'carry', ...emptyAssignment, schema: { columns: ['Issue Identified', 'Status'] }, defaultContent: { rows: [] } }
    ]
  },
  {
    id: 'financial-status',
    title: 'Section 3: Financial Status',
    order: 4,
    blocks: [
      { id: 'budget-expenditure', title: 'Budget vs Expenditure', contentType: 'table', required: true, carryPolicy: 'reset', ...emptyAssignment, schema: { columns: ['Line Item', 'Budget', 'Actual', 'Variance', 'Status'] }, defaultContent: { rows: [] } },
      { id: 'financial-narrative', title: 'Budget vs Expenditure Narrative', contentType: 'narrative', required: true, carryPolicy: 'review', ...emptyAssignment, defaultContent: '' },
      { id: 'resource-utilisation', title: 'Resource Utilisation', contentType: 'table', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Resource Type', 'Resource', 'Quantity/Notes'] }, defaultContent: { rows: [] } }
    ]
  },
  {
    id: 'looking-ahead',
    title: 'Section 4: Looking Ahead',
    order: 5,
    blocks: [
      { id: 'upcoming-milestones', title: 'Upcoming Milestones', contentType: 'narrative', required: true, carryPolicy: 'review', ...emptyAssignment, defaultContent: '' },
      { id: 'planned-activities', title: 'Planned Activities', contentType: 'narrative', required: true, carryPolicy: 'review', ...emptyAssignment, defaultContent: '' }
    ]
  },
  {
    id: 'project-health',
    title: 'Section 5: Overall Project Health',
    order: 6,
    blocks: [
      { id: 'health-assessment', title: 'Color-Coded Assessment', contentType: 'table', required: true, carryPolicy: 'review', ...emptyAssignment, schema: { columns: ['Phase / Workstream', 'Status', 'Comment'] }, defaultContent: { rows: [] } },
      { id: 'recommendations', title: 'Recommendations and Next Steps', contentType: 'narrative', required: true, carryPolicy: 'review', ...emptyAssignment, defaultContent: '' },
      { id: 'reporting-period', title: 'Reporting Period', contentType: 'narrative', required: true, carryPolicy: 'reset', ...emptyAssignment, defaultContent: '' },
      { id: 'conclusion', title: 'Conclusion', contentType: 'narrative', required: true, carryPolicy: 'review', ...emptyAssignment, defaultContent: '' }
    ]
  }
]
