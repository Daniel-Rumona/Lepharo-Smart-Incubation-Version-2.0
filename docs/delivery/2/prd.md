# PBI-2: Implement Branch Assignment System

[View in Backlog](../backlog.md#user-content-PBI-2)

## Overview

This PBI implements a comprehensive branch assignment system that allows **Directors** to assign branches to receptionists and center coordinators, while ensuring **Operations** users remain tied to departments. This establishes the foundational organizational structure for proper data access control and role-based permissions.

## Problem Statement

Currently, the platform lacks a systematic way to:
- Assign specific branches to receptionists and center coordinators
- Distinguish between branch-scoped roles (receptionist, CC) and department-scoped roles (operations)
- Provide directors with administrative control over branch assignments
- Ensure proper data segregation and access control based on organizational structure

## User Stories

### Primary User Story
As a **director**, I want to assign branches to receptionists and center coordinators, so that I can ensure proper organizational structure and data access control.

### Supporting User Stories
- As a **director**, I want to view all available branches, so that I can make informed assignment decisions
- As a **director**, I want to see which users are assigned to which branches, so that I can manage organizational structure
- As a **director**, I want to modify branch assignments when needed, so that I can adapt to organizational changes
- As a **center coordinator**, I want to know which branch I'm assigned to, so that I understand my scope of responsibility
- As a **receptionist**, I want to know which branch I represent, so that I can provide appropriate service

## Technical Approach

### Database Schema Changes
- Create `branches` collection in Firestore with branch details
- Add `assignedBranch` field to user documents for branch-scoped roles
- Maintain existing `department` field for operations users
- Create branch assignment audit trail

### Branch Management System
- Branch CRUD operations for directors
- User-branch assignment interface
- Branch assignment validation and conflict resolution
- Support for multiple branches per director (company scope)

### Access Control Implementation
- Branch-based data filtering for receptionists and center coordinators
- Department-based data filtering for operations users (unchanged)
- Role-based access control enforcement
- Data isolation verification

## UX/UI Considerations

### Director Interface
- Branch management dashboard
- User assignment interface with drag-and-drop or selection mechanism
- Visual representation of organizational structure
- Clear indication of assigned vs. unassigned users

### Branch Assignment Workflow
- Intuitive assignment process
- Confirmation dialogs for changes
- Visual feedback for successful assignments
- Error handling for conflicts or invalid assignments

### User Experience
- Clear indication of assigned branch in user profile
- Branch information displayed in navigation/header
- Consistent branch context throughout user session

## Acceptance Criteria

### Core Functionality
1. **Branch Management**: Directors can create, view, edit, and manage branches
2. **User Assignment**: Directors can assign receptionists and center coordinators to branches
3. **Data Isolation**: Users can only access data for their assigned branch
4. **Department Preservation**: Operations users remain tied to departments, not branches
5. **Assignment Validation**: System prevents invalid or conflicting assignments

### Technical Requirements
1. **Database**: Proper branch and assignment data structure implemented
2. **Access Control**: Branch-based filtering working correctly
3. **Performance**: Assignment operations complete within acceptable time
4. **Data Integrity**: Assignment changes properly propagated throughout system
5. **Audit Trail**: Changes to assignments are logged and traceable

### User Experience
1. **Interface**: Intuitive branch assignment interface for directors
2. **Feedback**: Clear confirmation and error messaging
3. **Context**: Users understand their branch assignment and scope
4. **Consistency**: Branch context maintained throughout user session
5. **Responsiveness**: Interface works on desktop and tablet devices

## Dependencies

- **Firebase Firestore**: Database schema updates required
- **Existing user management system**: Extension needed for branch assignments
- **Current role-based access control**: Enhancement needed for branch-level filtering
- **Director dashboard**: Interface updates required

## Open Questions

1. **Branch Structure**: What information should be stored for each branch (name, location, contact details, etc.)?
2. **Assignment Conflicts**: How should the system handle users who might need access to multiple branches?
3. **Historical Data**: How should existing users be handled when implementing branch assignments?
4. **Branch Hierarchy**: Should branches have hierarchical relationships or remain flat?
5. **Assignment Limits**: Should there be limits on how many users can be assigned to a single branch?
6. **Department Integration**: How should branches relate to existing department structure?

## Related Tasks

[View Task List](./tasks.md) 