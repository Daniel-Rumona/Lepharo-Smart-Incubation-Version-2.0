import { createContext, useContext } from 'react'
import type { AccentTheme, ResolvedColorMode } from '@/contexts/ThemeContext'
import type { RiskLevel } from '@twin/rules'

/** The twin follows the app's own colour mode; there is no separate twin theme. */
export type TwinTheme = ResolvedColorMode

export type TwinPalette = {
    theme: TwinTheme
    /** Level colours keep their meaning in every theme and accent: green, yellow, orange, red. */
    level: Record<RiskLevel, string>
    /** The app's accent (Settings → accent), in this mode's variant. */
    accent: {
        primary: string
        strong: string
        deep: string
    }
    /** Who a reason is waiting on: the SME, staff, or both. */
    owner: { sme: string; staff: string; both: string }
    /** Saved history in the time machine: neutral, so today and the outlook stand out. */
    past: string
    /** The what-if line and columns. */
    whatIf: string
    /** The core while the twin is still loading. */
    idle: string
}

/**
 * The accent palettes, one variant per mode. Mirrors --app-accent, --app-accent-strong
 * and --app-accent-deep in styles/dark-mode.css (blue) and styles/accent-themes.css
 * (crimson, ocean, violet), as ACCENT_PRIMARY in config/antdTheme.ts does. The twin's
 * CSS reads those variables directly; these are for the SVG and canvas drawing.
 */
const ACCENTS: Record<AccentTheme, Record<TwinTheme, TwinPalette['accent']>> = {
    crimson: {
        light: { primary: '#c8102e', strong: '#a60d26', deep: '#9e0c24' },
        dark: { primary: '#f0475a', strong: '#ff7a86', deep: '#c8102e' }
    },
    blue: {
        light: { primary: '#1677ff', strong: '#0958d9', deep: '#0b4fc4' },
        dark: { primary: '#4a9bff', strong: '#7db4ff', deep: '#2f7fe0' }
    },
    ocean: {
        light: { primary: '#0e9488', strong: '#0b7a70', deep: '#0f766e' },
        dark: { primary: '#2dd4bf', strong: '#6fe6d6', deep: '#0f9d8f' }
    },
    violet: {
        light: { primary: '#7c3aed', strong: '#5b21b6', deep: '#6425c4' },
        dark: { primary: '#a78bfa', strong: '#c4b5fd', deep: '#7c5cea' }
    }
}

const LEVELS: Record<TwinTheme, Record<RiskLevel, string>> = {
    dark: { Low: '#4ade80', Medium: '#facc15', High: '#fb923c', Critical: '#f43f5e' },
    light: { Low: '#16a34a', Medium: '#ca8a04', High: '#ea580c', Critical: '#e11d48' }
}

// Matches --app-text-subtle in styles/dark-mode.css.
const NEUTRAL: Record<TwinTheme, string> = { dark: '#8b919a', light: '#98a2b3' }

// SME items read warm, staff items take the app accent, shared ones sit between.
const SME_OWNER: Record<TwinTheme, string> = { dark: '#f6d58e', light: '#b45309' }

export function twinPalette(theme: TwinTheme, accentTheme: AccentTheme): TwinPalette {
    const accent = (ACCENTS[accentTheme] ?? ACCENTS.crimson)[theme]
    return {
        theme,
        level: LEVELS[theme],
        accent,
        owner: { sme: SME_OWNER[theme], staff: accent.primary, both: accent.strong },
        past: NEUTRAL[theme],
        whatIf: accent.strong,
        idle: accent.primary
    }
}

export const TwinPaletteContext = createContext<TwinPalette>(twinPalette('dark', 'crimson'))

export const usePalette = () => useContext(TwinPaletteContext)
