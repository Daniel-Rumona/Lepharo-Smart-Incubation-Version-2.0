# Branch Assignment Guide for Directors

## Overview
Directors can assign branches to receptionist users through the User Management interface. This is essential for receptionists to access the inquiries system, as they are branch-scoped users.

## Assigning Branches to Receptionists

### Step 1: Access User Management
1. Log in as a Director
2. Navigate to **"User Management"** in the left sidebar menu
3. This will open the comprehensive user management interface

### Step 2: Create or Edit a Receptionist User

#### For New Users:
1. Click the **"Add User"** button
2. Fill in the user details:
   - **Name**: Full name of the receptionist
   - **Email**: Their login email address
   - **Password**: Initial password (they can change it later)
   - **Role**: Select **"Receptionist"** from the dropdown

#### For Existing Users:
1. Find the receptionist user in the user table
2. Click the **Edit** button (pencil icon) in the Actions column
3. The edit form will open with current user details

### Step 3: Select Branch Assignment
1. When you select "Receptionist" as the role, a **"Branch"** field will appear
2. This field is **required** for receptionist users
3. Click the Branch dropdown to see all available branches
4. Select the appropriate branch for the receptionist
5. The dropdown shows branch names and locations (e.g., "Springs (Head Office) - Springs")

### Step 4: Save the Assignment
1. Click **"Create"** for new users or **"Update"** for existing users
2. The system will validate that a branch is selected
3. Upon successful save, the receptionist will be assigned to the selected branch

## Viewing Branch Assignments

In the User Management table, there's a **"Branch/Dept"** column that shows:
- 🏢 **Branch Name** for receptionists and center coordinators
- 🏭 **Department Name** for operations users  
- **"Not Assigned"** for users without assignments

## Troubleshooting

### "No branch assigned" Error
If a receptionist sees this error when accessing inquiries:
1. Check their user record in User Management
2. Verify they have the "Receptionist" role
3. Ensure a branch is assigned in the "Branch/Dept" column
4. Edit the user and assign a branch if missing

### Branch Not Showing in Dropdown
If branches don't appear in the dropdown:
1. Ensure branches are created via **Branch Management**
2. Check that branches are active (not marked as inactive)
3. Verify you have director permissions

### Receptionist Can't Access Features
After assigning a branch:
1. Have the receptionist **log out and log back in**
2. The branch assignment should take effect immediately
3. They should now see their assigned branch in their dashboard

## Branch Management
- Create and manage branches via **"Branch Management"** in the director menu
- Ensure branches are properly set up before assigning users
- Inactive branches won't appear in assignment dropdowns

## Security Notes
- Only directors can assign branches to users
- Receptionists can only see data for their assigned branch
- Branch assignments are logged for audit purposes
- Users must log out and back in for changes to take effect

## Related Features
- **Branch Management**: Create and manage branch locations
- **Department Management**: Manage departments for operations users
- **User Roles**: Different roles have different assignment requirements 