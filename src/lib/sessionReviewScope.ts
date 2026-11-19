/** Review finished sessions, including those still waiting for coverage. */
export const isSessionReviewStatus = (status: string): boolean =>
    ['completed', 'not_held', 'awaiting_coverage'].includes(status)
