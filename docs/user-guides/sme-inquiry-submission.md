# SME Inquiry Submission Guide

## Overview

The SME Inquiry Submission feature allows Subject Matter Experts (SMEs) to submit inquiries on behalf of clients and route them directly to specific branch locations for handling by receptionists. This creates a seamless workflow for client support and business development.

## How to Access

1. **Login as an SME**: Use your SME/incubatee credentials to access the platform
2. **Navigate to SME Dashboard**: Go to `/incubatee/sme` 
3. **Submit Inquiry**: Click the "Submit Inquiry" button on the dashboard

## Step-by-Step Process

### Step 1: Contact Information
- Enter the client's personal and business contact details
- Required fields: First Name, Last Name, Email, Phone
- Optional: Company, Position

### Step 2: Inquiry Details
- Select inquiry type (General Information, Incubation Program, Funding, etc.)
- Choose business stage and industry
- Set priority level (Low, Medium, High, Urgent)
- Select up to 5 services of interest
- Provide detailed description of the inquiry
- Specify budget range and timeline

### Step 3: Branch Selection & Follow-up
- **Choose Target Branch**: Select which branch location should handle the inquiry
- View branch details including location and contact information
- Set optional follow-up preferences:
  - Preferred follow-up date
  - Contact method (Phone, Email, In-person, Video Call)
  - Additional notes

### Step 4: Review & Submit
- Review all entered information
- Confirm branch selection
- Submit the inquiry

## Branch Integration

### For Receptionists
- SME-submitted inquiries appear in the receptionist's inquiry list
- Inquiries are marked with source "SME" for easy identification
- All standard inquiry management features are available:
  - Status updates
  - Follow-up scheduling
  - Communication logging
  - Priority management

### Branch Selection Benefits
- SMEs can route inquiries to the most appropriate branch based on:
  - Geographic location
  - Specialization
  - Capacity
  - Client preferences

## Features

### Multi-Step Form
- User-friendly step-by-step process
- Form validation at each step
- Progress tracking with visual indicators

### Branch Information
- Real-time branch selection with detailed information
- Contact details and location data
- Active branch filtering

### Follow-up Management
- Optional follow-up scheduling
- Multiple contact method options
- Custom notes for specific instructions

### Success Confirmation
- Clear confirmation of successful submission
- Option to submit additional inquiries
- Return to dashboard functionality

## Data Flow

1. **SME Submission**: SME completes inquiry form and selects branch
2. **Database Storage**: Inquiry stored with source "SME" and assigned branch
3. **Receptionist Notification**: Inquiry appears in target branch's inquiry list
4. **Follow-up Process**: Receptionist contacts client based on inquiry details
5. **Status Updates**: Progress tracked through standard inquiry management

## Best Practices

### For SMEs
- Provide complete client contact information
- Use appropriate priority levels
- Select the most relevant branch based on client location/needs
- Include detailed descriptions for better service
- Set realistic follow-up expectations

### For Receptionists
- Prioritize urgent inquiries from SMEs
- Contact clients within specified timeframes
- Update inquiry status regularly
- Log all communications for tracking

## Security & Access

- SMEs must be authenticated to submit inquiries
- Branch assignment validation ensures proper routing
- All inquiries are company-scoped for multi-tenant security
- Audit trails maintained for all submissions

## Integration Points

- **Inquiry Service**: Uses existing inquiry management system
- **Branch Service**: Leverages branch management for routing
- **User Authentication**: Integrates with existing auth system
- **Dashboard Analytics**: SME inquiries included in reporting

## Support

For issues with the SME inquiry submission feature:
1. Check branch availability and user permissions
2. Verify network connectivity for branch data loading
3. Contact system administrators for technical support
4. Review user guides for proper submission procedures 