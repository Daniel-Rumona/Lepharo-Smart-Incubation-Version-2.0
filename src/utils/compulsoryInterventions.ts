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

export const eligiblePlanInterventions = (
    items: any[], definitions: any[], confirmed: boolean
): any[] => items.filter(item => confirmed || isCompulsoryIntervention(item, definitions))
