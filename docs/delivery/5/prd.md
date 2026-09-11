# PBI-5: M&E MOV Integration for Intervention Database

[View in Backlog](../backlog.md#user-content-PBI-5)

## Overview

This PBI implements Means of Verification (MOV) functionality within the existing intervention database interface. The MOV system will automatically generate verification documents for completed interventions and provide M&E departments with proper documentation and compliance tracking capabilities.

## Problem Statement

Currently, the intervention database tracks completed interventions but lacks formal Means of Verification documentation required for M&E compliance and audit purposes. The M&E department needs a systematic way to generate, manage, and track MOV documents that verify the completion and quality of interventions delivered to beneficiaries.

## User Stories

### Primary User Story
As an **M&E department user**, I want to automatically generate and manage Means of Verification (MOV) documents for completed interventions within the intervention database, so that I can ensure proper documentation and compliance verification for each beneficiary's interventions.

### Supporting User Stories
- As an **M&E user**, I want to view MOV documents associated with each beneficiary's completed interventions, so that I can verify intervention delivery and quality.
- As an **operations user**, I want MOV documents to be automatically generated when interventions are marked as completed, so that verification documentation is captured without manual overhead.
- As an **auditor**, I want to access standardized MOV documents for each intervention, so that I can verify compliance with incubation program requirements.

## Technical Approach

### Integration Point
- **Location**: Extend existing Intervention Database view (`src/routes/interventions/index.tsx`)
- **UI Integration**: Add "MOV Documents" section within each beneficiary's intervention details modal
- **Data Source**: Leverage existing `interventionsDatabase` collection in Firestore

### MOV Auto-Generation Workflow
1. **Trigger**: When intervention `userCompletionStatus` changes to `'confirmed'` in the intervention completion process
2. **Data Collection**: Extract intervention details from `interventionsDatabase` entry
3. **MOV Creation**: Generate MOV document with standardized format based on MOV-example.md
4. **Storage**: Save MOV record to new `movDocuments` Firestore collection

### Data Structure Extensions

#### New Firestore Collection: `movDocuments`
```typescript
interface MOVDocument {
  id: string
  interventionKey: string // Link to interventionsDatabase entry
  participantId: string
  beneficiaryName: string
  smmeNo: string
  smmeSector: string
  groupStage: 'A' | 'B' | 'C'
  interventionMethod: 'In-person' | 'Online' | 'Telephonic' | 'Other'
  frequencyOfIntervention: 'Once a month' | 'Every two weeks' | 'Weekly' | 'Other'
  interventionType: string // From intervention details
  interventionDate: Date
  facilitatorName: string // From consultant data
  facilitatorSignature?: string // Digital signature
  clientSignature?: string // Digital signature
  finalCheckerName?: string
  finalCheckerSignature?: string
  dateChecked?: Date
  createdAt: Date
  updatedAt: Date
  status: 'generated' | 'signed' | 'verified' | 'complete'
  companyCode: string // For multi-tenancy
}
```

#### Extension to existing `interventionsDatabase` entries
- Add `movDocumentId?: string` field to link completed interventions to their MOV documents

## UX/UI Considerations

### Intervention Database Integration
- **Beneficiary Details Modal**: Add "MOV Documents" tab alongside existing intervention details
- **MOV List View**: Display table of MOV documents for each beneficiary with status indicators
- **MOV Details View**: Modal showing full MOV document details with signature status
- **Status Indicators**: Color-coded badges showing MOV completion status (Generated, Signed, Verified, Complete)

### Visual Design
- **Consistent Styling**: Follow existing Ant Design patterns used in intervention database
- **Status Icons**: Use appropriate icons for different MOV statuses (CheckCircleOutlined, EditOutlined, etc.)
- **Mobile Responsive**: Ensure MOV views work on tablets and mobile devices used in field operations

## Acceptance Criteria

### AC1: MOV Auto-Generation
- [ ] When an intervention is marked as `userCompletionStatus: 'confirmed'`, a MOV document is automatically created
- [ ] MOV document includes all required fields from the intervention data and participant information
- [ ] MOV document is linked to the intervention via `interventionKey`
- [ ] MOV creation does not interfere with existing intervention completion workflow

### AC2: MOV Display in Intervention Database
- [ ] Beneficiary details modal includes "MOV Documents" section/tab
- [ ] MOV list shows intervention type, date, facilitator name, and completion status
- [ ] Users can view detailed MOV document information in a modal
- [ ] MOV status is clearly indicated with appropriate visual cues

### AC3: Data Integrity and Security
- [ ] MOV documents are properly scoped by `companyCode` for multi-tenancy
- [ ] MOV generation handles missing participant data gracefully
- [ ] Error handling prevents intervention completion from failing due to MOV issues
- [ ] MOV documents maintain audit trail with creation and update timestamps

### AC4: Performance and Scalability
- [ ] MOV document queries are efficient and don't impact intervention database performance
- [ ] MOV list pagination works for beneficiaries with many interventions
- [ ] MOV auto-generation is asynchronous and doesn't block intervention completion

## Dependencies

- **Existing Systems**: Intervention Database (`src/routes/interventions/index.tsx`)
- **Data Collections**: `interventionsDatabase`, `participants`, `consultants` Firestore collections
- **Authentication**: Current user authentication and role-based access system
- **UI Framework**: Ant Design components and existing styling patterns

## Open Questions

1. **Signature Implementation**: Should digital signatures be implemented in this PBI or handled in a future enhancement?
2. **MOV Templates**: Should we support multiple MOV templates for different intervention types?
3. **Bulk Operations**: Do we need bulk MOV generation or management capabilities?
4. **Notification System**: Should MOV generation trigger notifications to M&E staff?

## Related Tasks

[View Tasks](./tasks.md) 