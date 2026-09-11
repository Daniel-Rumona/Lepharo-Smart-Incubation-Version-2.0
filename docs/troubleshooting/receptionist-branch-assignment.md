# Receptionist Branch Assignment Troubleshooting

## Problem: "No branch assigned. Please contact your administrator."

### Description
Receptionist users are getting an error message saying they have no branch assigned when trying to access the dashboard or create inquiries.

### Root Cause
The receptionist role is **branch-scoped**, meaning receptionists must be assigned to a specific branch to access their features. This is a security requirement to ensure data segregation by branch.

## Solutions

### Option 1: Use the User Management Interface (Recommended for Directors)

1. **Log in as a Director** - Only directors can assign branches through the UI
2. **Navigate to User Management** - Find the user management section in the admin interface
3. **Find the Receptionist User** - Locate the receptionist user in the user list
4. **Edit the User** - Click the edit button for the receptionist user
5. **Assign Branch** - Select a branch from the dropdown menu for "Branch Assignment"
6. **Save Changes** - The receptionist will immediately be able to access their dashboard

### Option 2: Use the Branch Assignment Script (For System Administrators)

If you have access to the project files and Node.js:

```bash
# First, ensure you have the required dependencies
cd /path/to/your/project
npm install

# List all available branches
node scripts/assign-branch-to-receptionist.js list-branches

# List all receptionists and their current assignments
node scripts/assign-branch-to-receptionist.js list-receptionists

# Assign a branch to a receptionist
node scripts/assign-branch-to-receptionist.js assign "receptionist@example.com" "Springs (Head Office)"
```

#### Example Output:
```
🚀 Branch Assignment Utility for Receptionists

🔍 Looking for receptionist user: receptionist@lepharo.co.za
✅ Found receptionist user: Sarah Smith
🔍 Looking for branch: Springs (Head Office)
✅ Found branch: Springs (Head Office) at Springs
🎉 Successfully assigned Sarah Smith to Springs (Head Office) branch!
   Branch ID: abc123def456
   User can now access the receptionist dashboard
```

### Option 3: Manual Database Update (Advanced Users Only)

If you have direct Firestore access:

1. **Open Firestore Console** - Go to your Firebase project's Firestore database
2. **Navigate to users collection** - Find the receptionist user document
3. **Add/Update fields**:
   ```javascript
   {
     "assignedBranch": "BRANCH_DOCUMENT_ID",
     "branchAssignmentHistory": [
       {
         "branchId": "BRANCH_DOCUMENT_ID",
         "assignedAt": "2025-01-09T10:00:00.000Z",
         "assignedBy": "manual-assignment",
         "reason": "Manual branch assignment"
       }
     ],
     "branchPermissions": {
       "canViewAllInquiries": true,
       "canCreateInquiries": true,
       "canEditInquiries": false,
       "canViewAnalytics": false
     }
   }
   ```

## Branch Setup

### Ensure Branches Exist
Before assigning users to branches, make sure branches are properly set up:

1. **Check Available Branches**:
   ```bash
   node scripts/assign-branch-to-receptionist.js list-branches
   ```

2. **Initialize Default Lepharo Branches** (if needed):
   - Use the Branch Management interface as a Director
   - Or run the branch initialization function in the branchService

### Default Lepharo Branches
The system includes these default branches:
- Springs (Head Office)
- Rustenburg  
- Mogale City
- Welkom
- Matlosana
- Khutsong

## Verification

### Test the Assignment
After assigning a branch:

1. **Have the receptionist log out and log back in**
2. **Navigate to the receptionist dashboard**
3. **Verify they can**:
   - See the dashboard with their assigned branch name
   - Create new inquiries
   - View the inquiries list
   - Access all receptionist features

### Check the Assignment
```bash
# Verify the assignment was successful
node scripts/assign-branch-to-receptionist.js list-receptionists
```

Should show:
```
👥 Current receptionists:
   ✅ Assigned Sarah Smith (receptionist@lepharo.co.za)
      Branch ID: abc123def456
```

## Security Notes

- **Branch Isolation**: Receptionists can only see data for their assigned branch
- **Role Validation**: Only users with the 'receptionist' role can be assigned branches through this process
- **Audit Trail**: All branch assignments are logged in the user's `branchAssignmentHistory`
- **Director Override**: Directors can view and manage all branches regardless of assignment

## Common Issues

### "No receptionist user found with email"
- Verify the email address is correct
- Ensure the user exists and has role='receptionist'
- Check that the user document is properly formatted

### "No branch found with name"
- Verify the branch name is exactly correct (case-sensitive)
- Use `list-branches` command to see available branches
- Ensure branches have been initialized

### "Permission denied" errors
- Ensure your Firebase credentials have proper access
- Check that Firestore security rules allow the operation
- Verify you're connecting to the correct Firebase project

### Branch assignment doesn't take effect
- Have the user log out and log back in
- Check browser cache/storage
- Verify the assignment was saved in Firestore
- Check for JavaScript console errors

## Related Documentation

- [User Management Guide](../user-management/user-management.md)
- [Branch Management Guide](../branch-management/branch-management.md) 
- [Receptionist Role Documentation](../roles/receptionist.md)
- [Firestore Security Rules](../security/firestore-rules.md) 