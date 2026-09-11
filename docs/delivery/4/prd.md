# PBI-4: Modify Center Coordinator Role Scope

[View in Backlog](../backlog.md#user-content-PBI-4)

## Overview

This PBI modifies the existing **Center Coordinator** (Project Admin) role to properly scope access permissions, excluding impact analysis while maintaining high-level branch access. This ensures role responsibilities are clearly defined and appropriate to the position's function within the organization.

## Problem Statement

Currently, the Center Coordinator role (implemented as `projectadmin`) has:
- Access to impact analysis features that should be restricted
- Unclear boundaries on what functionality they should access
- Need for better definition of role scope and responsibilities
- Required clarification of the relationship to inquiry analytics (PBI-3)

## User Stories

### Primary User Story
As a **center coordinator**, I want to have my role properly scoped to exclude impact analysis while maintaining high-level branch access, so that my responsibilities are clearly defined and appropriate.

### Supporting User Stories
- As a **center coordinator**, I want access to inquiry analytics but not impact analysis, so that I focus on appropriate operational metrics
- As a **center coordinator**, I want clear visibility into my permissions, so that I understand what I can and cannot access
- As a **director**, I want center coordinators to have appropriate access levels, so that sensitive impact data remains properly controlled
- As a **system administrator**, I want clearly defined role boundaries, so that security and access control are properly maintained

## Technical Approach

### Access Control Modifications
- Review existing `projectadmin` role permissions
- Remove access to impact analysis modules
- Maintain access to monitoring and evaluation functions appropriate for center coordinators
- Ensure branch-level data filtering works correctly

### Role Definition Refinement
- Update role description and capabilities documentation
- Modify navigation menus to exclude impact analysis
- Update route guards to prevent access to restricted features
- Ensure consistent role enforcement across all components

### Permission System Enhancement
- Implement granular permission checking for center coordinator features
- Add clear permission denied messaging for restricted areas
- Update user interface to hide inaccessible features
- Ensure proper error handling for unauthorized access attempts

## UX/UI Considerations

### Navigation Updates
- Remove impact analysis navigation items from center coordinator menu
- Ensure remaining navigation is clear and intuitive
- Maintain consistent platform design language
- Add helpful tooltips or indicators for role-specific features

### Access Control Feedback
- Clear messaging when users attempt to access restricted features
- Helpful redirection to appropriate alternative features
- Consistent error messaging across the platform
- Visual indicators for role-specific content

### Role Clarity
- Clear indication of role scope in user profile/dashboard
- Documentation or help sections explaining center coordinator capabilities
- Intuitive organization of available features and tools

## Acceptance Criteria

### Access Control
1. **Impact Analysis Restriction**: Center coordinators cannot access impact analysis features
2. **Branch Access Maintained**: Center coordinators retain appropriate branch-level access
3. **Monitoring Access**: Center coordinators can still access monitoring and evaluation tools
4. **Navigation Consistency**: Navigation menus reflect proper role permissions
5. **Error Handling**: Clear messaging for any access restriction scenarios

### Role Definition
1. **Permission Clarity**: Role permissions are clearly defined and documented
2. **Consistent Enforcement**: Access restrictions are enforced consistently across all components
3. **User Understanding**: Center coordinators understand their role scope and capabilities
4. **Administrative Control**: Directors can manage center coordinator permissions appropriately
5. **Security Compliance**: Role modifications maintain platform security standards

### User Experience
1. **Intuitive Interface**: Role-appropriate interface that doesn't confuse users
2. **Clear Feedback**: Users understand what they can and cannot access
3. **Seamless Operation**: Role restrictions don't interfere with legitimate functionality
4. **Helpful Guidance**: Users are guided to appropriate features for their role
5. **Consistent Design**: Interface changes maintain platform design consistency

## Dependencies

- **Existing `projectadmin` role implementation**: Understanding current permissions
- **Impact analysis modules**: Identification of what to restrict
- **Authentication system**: Role-based access control mechanisms
- **PBI-2**: Branch assignment system for proper data scoping
- **Navigation components**: Updates needed for menu modifications

## Open Questions

1. **Specific Restrictions**: Exactly which impact analysis features should be restricted?
2. **Alternative Features**: What functionality should replace restricted features in the interface?
3. **Role Naming**: Should the role be renamed from "projectadmin" to "centercoordinator" for clarity?
4. **Granular Permissions**: How granular should the permission system be for this role?
5. **Documentation Access**: Should center coordinators have access to view (but not modify) impact reports?
6. **Transition Plan**: How should existing center coordinators be notified of role changes?

## Related Tasks

[View Task List](./tasks.md) 