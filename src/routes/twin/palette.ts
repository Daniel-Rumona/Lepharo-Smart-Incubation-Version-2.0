import { createContext, useContext } from 'react'
import type { RiskLevel } from '@twin/rules'

export type TwinTheme = 'dark' | 'light'

export type TwinPalette = {
    theme: TwinTheme
    /** Level colours keep their meaning in both themes: green, yellow, orange, red. */
    level: Record<RiskLevel, string>
    /**
     * Each panel's own colour. None is blue (the scene's atmosphere already is)
     * and none repeats a level colour, so a warning never looks like decoration.
     */
    accent: {
        emerald: string
        violet: string
        orchid: string
        champagne: string
        pearl: string
        rose: string
        lilac: string
    }
    /** Saved history in the time machine. */
    past: string
    /** The what-if line and columns. */
    whatIf: string
    /** The core while the twin is still loading. */
    idle: string
}

// Dark: glowing pastels on deep navy. Light: the same families, deeper, so they
// read on white (pale champagne or pearl would vanish on a light page).
export const PALETTES: Record<TwinTheme, TwinPalette> = {
    dark: {
        theme: 'dark',
        level: { Low: '#4ade80', Medium: '#facc15', High: '#fb923c', Critical: '#f43f5e' },
        accent: {
            emerald: '#34d399',
            violet: '#a78bfa',
            orchid: '#e879f9',
            champagne: '#f6d58e',
            pearl: '#f5d0fe',
            rose: '#fda4af',
            lilac: '#c4b5fd'
        },
        past: '#c4b5fd',
        whatIf: '#5eead4',
        idle: '#22d3ee'
    },
    light: {
        theme: 'light',
        level: { Low: '#16a34a', Medium: '#ca8a04', High: '#ea580c', Critical: '#e11d48' },
        accent: {
            emerald: '#059669',
            violet: '#7c3aed',
            orchid: '#c026d3',
            champagne: '#92400e',
            pearl: '#9333ea',
            rose: '#db2777',
            lilac: '#6d28d9'
        },
        past: '#8b5cf6',
        whatIf: '#0d9488',
        idle: '#7c3aed'
    }
}

export const TwinPaletteContext = createContext<TwinPalette>(PALETTES.dark)

export const usePalette = () => useContext(TwinPaletteContext)

const STORAGE_KEY = 'digital-twin-theme'

/** The viewer's own choice for the twin, if they made one. Storage can be unavailable. */
export function readStoredTwinTheme(): TwinTheme | null {
    try {
        const value = window.localStorage.getItem(STORAGE_KEY)
        return value === 'light' || value === 'dark' ? value : null
    } catch {
        return null
    }
}

export function storeTwinTheme(theme: TwinTheme) {
    try {
        window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
        // Private windows can refuse storage; the toggle still works for this visit.
    }
}
