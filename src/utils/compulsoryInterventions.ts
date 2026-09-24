export const interventionId = (item: any): string =>
    String(item?.id || item?.interventionId || '').trim()

/** The live definition is authoritative, including when compulsory is switched off. */
export const isCompulsoryIntervention = (item: any, definitions: any[]): boolean =>
    definitions.find(definition => interventionId(definition) === interventionId(item))?.compulsory === true

export function mergeCompulsoryInterventions(items: any[], definitions: any[]): any[] {
    const result = [...items]
    for (const definition of definitions.filter(item => item.compulsory === true)) {
        const id = interventionId(definition)
        if (!id || result.some(item => interventionId(item) === id)) continue
        result.push({
            ...definition,
            id,
            title: definition.interventionTitle || definition.title || 'Intervention',
            area: definition.areaOfSupport || definition.area || '',
            source: 'compulsory',
        })
    }
    return result
}

/**
 * Nothing is assignable until both the department and the SME have signed off
 * on the DP — including compulsory items. Departments that operate without a
 * DP (isMonitoring === true) never call this; they assign compulsory
 * interventions directly instead.
 */
export const eligiblePlanInterventions = (
    items: any[], confirmed: boolean
): any[] => confirmed ? items : []
