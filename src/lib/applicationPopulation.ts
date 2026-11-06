/** Shared population rules for Applications, SME Overview and ROM. */
export const applicationProgramId = (app: any): string =>
    String(app.programId || app.programID || app.program?.id || app.program || '').trim()

export const applicationDecisionStatus = (app: any): string => {
    // Current decisions take precedence over historical acceptance evidence.
    for (const value of [app.applicationStatus, app.status, app.decision?.status]) {
        const status = String(value || '').trim().toLowerCase()
        if (status) return status
    }
    return app.acceptedAt ? 'accepted' : 'pending'
}

export const isAcceptedApplication = (app: any): boolean =>
    applicationDecisionStatus(app) === 'accepted'
