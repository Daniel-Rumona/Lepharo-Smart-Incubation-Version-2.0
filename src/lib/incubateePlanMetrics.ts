/** Staff finalisation alone does not record the incubatee's acceptance. */
export const canShowIncubateePlanMetrics = (
    plan: { finalConfirmation?: boolean; incubateeConfirmation?: boolean } | null | undefined,
    plansLoading: boolean,
    pendingDepartments: number,
    planParticipantId: string | null,
    participantId: string
): boolean => Boolean(
    participantId &&
    planParticipantId === participantId &&
    !plansLoading &&
    pendingDepartments === 0 &&
    plan?.finalConfirmation === true &&
    plan?.incubateeConfirmation === true
)
