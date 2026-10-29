import React from 'react'
import { EntityAvatar } from '@/components/workspace'
import { displayName, type Application } from './applicationData'

const photoOf = (app: Application): string | undefined =>
    [app.photoURL, app.logoUrl, app.logoURL, app.companyLogoUrl].find(
        (v): v is string => typeof v === 'string' && v.trim() !== ''
    )

/** The applicant's logo or photo when one is stored, otherwise their initials. */
export const ApplicantAvatar: React.FC<{ app: Application; size?: number }> = ({ app, size = 36 }) => (
    <EntityAvatar name={displayName(app)} photo={photoOf(app)} size={size} />
)
