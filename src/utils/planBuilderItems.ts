// Identity of an intervention inside the Developmental Plan builder.
//
// An intervention is its id. The title is only what it is called today, and the
// plan, the SME's requirements and the library can each hold a copy of it from
// a different moment. Keying on id + title made a renamed intervention appear
// twice: once under the title the plan saved, once under the new library title.

type Item = { id?: unknown; title?: unknown }

const clean = (value: unknown) => String(value ?? '').trim()

/** Same intervention, whatever it is called. Items with no id fall back to their title. */
export const builderKey = (item: Item): string => {
    const id = clean(item.id)
    return id ? `id:${id}` : `title:${clean(item.title).toLowerCase()}`
}

/** Keeps the first of each intervention. */
export function uniqueBuilderItems<T extends Item>(items: T[]): T[] {
    const seen = new Set<string>()
    return items.filter(item => {
        const key = builderKey(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

/**
 * Use the library's current title for anything it still knows about. Saved
 * plans keep working, and the next save writes the up-to-date name back.
 */
export function relabelFromCatalog<T extends Item>(items: T[], titlesById: Map<string, string>): T[] {
    return items.map(item => {
        const live = titlesById.get(clean(item.id))
        return live ? { ...item, title: live } : item
    })
}
