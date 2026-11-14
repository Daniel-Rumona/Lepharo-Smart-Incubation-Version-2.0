import { useColorMode, type AccentTheme, type ResolvedColorMode } from '@/contexts/ThemeContext'
import { ACCENT_PRIMARY } from '@/config/antdTheme'

/**
 * Colour for neutral data: a revenue line, a count over time, an "on track"
 * status. Anything that is not itself good or bad news.
 *
 * Charts follow the selected accent so they feel part of the theme, but only
 * when that accent cannot be mistaken for a judgement. Crimson, the default
 * brand red, reads as loss, risk or failure in a chart, so neutral data falls
 * back to the standard blue under it.
 *
 * Good and bad news never use this: profit/loss, risk levels and statuses use
 * the semantic tokens (colorSuccess, colorWarning, colorError), which do not
 * change with the accent. A new accent joins DATA_SAFE_ACCENTS only if it is
 * clearly apart from those (not red, orange, amber or green).
 */
const DATA_SAFE_ACCENTS: ReadonlySet<AccentTheme> = new Set<AccentTheme>(['blue', 'ocean', 'violet'])

const FALLBACK_ACCENT: AccentTheme = 'blue'

export const dataColor = (accent: AccentTheme, mode: ResolvedColorMode) =>
    ACCENT_PRIMARY[DATA_SAFE_ACCENTS.has(accent) ? accent : FALLBACK_ACCENT][mode]

/** The neutral data colour for the current accent and colour mode. */
export function useDataColor() {
    const { accent, mode } = useColorMode()
    return dataColor(accent, mode)
}
