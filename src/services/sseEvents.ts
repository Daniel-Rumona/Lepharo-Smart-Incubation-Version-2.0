/**
 * Server-sent events from a fetch() body: "data: {json}" blocks separated by a blank line.
 * Pure (no app imports) so sseEvents.test.cjs can load it directly.
 */

/** Splits what has arrived so far into complete events and the unfinished remainder. */
export function takeSseEvents(buffer: string): { events: unknown[]; rest: string } {
    const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
    const rest = blocks.pop() ?? ''
    const events: unknown[] = []
    for (const block of blocks) {
        const data = block
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).replace(/^ /, ''))
            .join('\n')
        if (!data) continue
        try {
            events.push(JSON.parse(data))
        } catch {
            // A malformed event is skipped; the stream carries on.
        }
    }
    return { events, rest }
}
