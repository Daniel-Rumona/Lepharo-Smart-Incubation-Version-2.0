/**
 * Behaviour measured in the pilot programme, used as defaults when this programme has too little history of its own.
 * Source: `scripts/digital-twin/analyze-demand.cjs --old`, read-only aggregates measured 12 Oct 2026 (562 SME x department
 * sign-offs, 2,569 assignments, 925 sessions). The pilot's first weeks pre-date the plan sign-off workflow and were mostly
 * learning, so only the settled behaviour is used here. Replace these as the new programme produces its own history.
 */
export const PILOT = {
    /** SMEs have interventions in about this many departments (median 6). */
    departmentsPerSme: 6,
    /** A department that has signed requires about this many interventions (median 7). Shown for context. */
    requiredPerDepartment: 7,
    /**
     * Average interventions opened per department by N days after that department signed (pilot means). They open slowly:
     * the first almost at once, then roughly one in the first month, about a fifth of the list by 12 weeks, 30% by 26 weeks.
     */
    openedPerDepartmentByDay: [[14, 1.0], [28, 1.2], [56, 1.6], [84, 1.8], [182, 1.9]] as ReadonlyArray<readonly [number, number]>,
    /** Sessions one intervention needs (planned sessions of recent assignments): mean 1.5, 36% need more than one, p90 2, max 5. */
    sessionsMix: [{ key: '1', weight: 64 }, { key: '2', weight: 26 }, { key: '3', weight: 7 }, { key: '4', weight: 2 }, { key: '5', weight: 1 }] as ReadonlyArray<{ key: string; weight: number }>,
    /** Median gap between consecutive sessions of one intervention (p25 7, p75 13); two on the same day was 0.6%. */
    daysBetweenSessions: 7,
    /** Sessions per facilitator per day: median 2, p75 4, p90 5.5. The p75 is used as a practical daily ceiling. */
    sessionsPerFacilitatorPerDay: 4,
    /** New interventions created per SME per week (about 102 a week across about 125 SMEs with open work). */
    newInterventionsPerSmePerWeek: 0.8
} as const

/** Cumulative interventions a brand-new SME has had opened `day` days after joining (linear between the measured points). */
export function newSmeInterventionsBy(day: number): number {
    if (day <= 0) return 0
    const points: Array<readonly [number, number]> = [[0, 0], ...PILOT.openedPerDepartmentByDay.map(([d, v]) => [d, v * PILOT.departmentsPerSme] as const)]
    for (let i = 1; i < points.length; i++) {
        const [d0, v0] = points[i - 1], [d1, v1] = points[i]
        if (day <= d1) return v0 + (v1 - v0) * (day - d0) / (d1 - d0)
    }
    return points[points.length - 1][1]
}

export const meanSessions = (mix: ReadonlyArray<{ key: string; weight: number }>) => {
    const total = mix.reduce((n, m) => n + m.weight, 0) || 1
    return mix.reduce((n, m) => n + Number(m.key) * m.weight, 0) / total
}
