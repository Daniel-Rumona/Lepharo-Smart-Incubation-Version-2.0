# Product Backlog

This document contains all Product Backlog Items (PBIs) for the LPH Smart Incubation Platform, ordered by priority.

## PBI Summary

| ID | Actor | User Story | Status | Conditions of Satisfaction (CoS) |
|----|----|------------|--------|----------------------------------|
| PBI-1 | Receptionist | As a **receptionist**, I want to be able to submit and manage inquiries for my specific branch, so that I can capture leads and provide front-facing support efficiently. | Agreed | [View Details](./1/prd.md) |
| PBI-2 | Director | As a **director**, I want to assign branches to receptionists and center coordinators, so that I can ensure proper organizational structure and data access control. | Done | [View Details](./2/prd.md) |
| PBI-3 | Center Coordinator | As a **center coordinator**, I want to view and analyze inquiries from my assigned branch, so that I can understand demand patterns and optimize our services. | Proposed | [View Details](./3/prd.md) |
| PBI-4 | Center Coordinator | As a **center coordinator**, I want to have my role properly scoped to exclude impact analysis while maintaining high-level branch access, so that my responsibilities are clearly defined and appropriate. | Proposed | [View Details](./4/prd.md) |
| PBI-5 | M&E Department | As an **M&E department user**, I want to automatically generate and manage Means of Verification (MOV) documents for completed interventions within the intervention database, so that I can ensure proper documentation and compliance verification for each beneficiary's interventions. | Agreed | [View Details](./5/prd.md) |

## PBI History Log

| Timestamp | PBI_ID | Event_Type | Details | User |
|-----------|--------|------------|---------|------|
| 20250608-210000 | ALL | create_pbi | Initial PBI creation based on project_task_list.md requirements | AI_Agent |
| 20250608-213000 | PBI-2 | propose_for_backlog | PBI-2 approved and moved to Agreed status for implementation | User |
| 20250608-214500 | PBI-2 | approve | PBI-2 completed with branch/department management systems implemented | User |
| 20250608-214500 | PBI-1 | propose_for_backlog | PBI-1 approved and moved to Agreed status for implementation | User |
| 20250116-194500 | PBI-5 | create_pbi | Created MOV integration PBI for intervention database based on user requirements | AI_Agent |
| 20250116-195500 | PBI-5 | propose_for_backlog | PBI-5 approved and moved to Agreed status for MOV implementation | User |

## Notes

- PBIs are ordered by implementation priority
- All PBIs are currently in "Proposed" status pending user approval
- Each PBI has detailed documentation in its respective subdirectory
- Dependencies between PBIs: PBI-1 and PBI-3 depend on PBI-2 (branch assignment system) 