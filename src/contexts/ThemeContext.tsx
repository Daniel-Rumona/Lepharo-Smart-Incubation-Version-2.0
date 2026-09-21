import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";

/**
 * Colour-mode preference. "system" follows the OS setting and keeps following it
 * if the user changes it while the app is open.
 */
export type ColorModePreference = "light" | "dark" | "system";

/** The mode actually being painted right now — "system" is always resolved away. */
export type ResolvedColorMode = "light" | "dark";

/**
 * Accent palette. Orthogonal to light/dark: each accent has its own light and
 * dark variant, so any of the three can be paired with any colour mode.
 */
export type AccentTheme = "blue" | "ocean" | "violet";

export const ACCENT_THEMES: AccentTheme[] = ["blue", "ocean", "violet"];

type ThemeContextValue = {
    /** What the user picked. */
    preference: ColorModePreference;
    /** What is on screen. */
    mode: ResolvedColorMode;
    isDark: boolean;
    setPreference: (next: ColorModePreference) => void;
    /** Flips between light and dark, dropping "system" in the process. */
    toggle: () => void;
    /** The chosen accent palette. */
    accent: AccentTheme;
    setAccent: (next: AccentTheme) => void;
};

const STORAGE_KEY = "lph-color-mode";
const ACCENT_STORAGE_KEY = "lph-accent-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

const prefersDark = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

const readStoredPreference = (): ColorModePreference => {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored === "light" || stored === "dark" || stored === "system") {
            return stored;
        }
    } catch {
        // Private mode / storage disabled — fall through to the default.
    }
    return "system";
};

const readStoredAccent = (): AccentTheme => {
    try {
        const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY);
        if (stored === "blue" || stored === "ocean" || stored === "violet") {
            return stored;
        }
    } catch {
        // Private mode / storage disabled — fall through to the default.
    }
    return "blue";
};

const resolve = (preference: ColorModePreference): ResolvedColorMode =>
    preference === "system" ? (prefersDark() ? "dark" : "light") : preference;

/**
 * Paints the mode onto <html> so plain CSS (and the browser's own form controls,
 * scrollbars and autofill) can react to it. Kept as a standalone function so the
 * anti-flash script in index.html mirrors exactly this behaviour.
 */
const applyToDocument = (mode: ResolvedColorMode) => {
    const root = document.documentElement;
    root.setAttribute("data-theme", mode);
    root.style.colorScheme = mode;
};

const applyAccentToDocument = (accent: AccentTheme) => {
    document.documentElement.setAttribute("data-accent", accent);
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [preference, setPreferenceState] = useState<ColorModePreference>(readStoredPreference);
    const [mode, setMode] = useState<ResolvedColorMode>(() => resolve(readStoredPreference()));
    const [accent, setAccentState] = useState<AccentTheme>(readStoredAccent);

    // Keep the DOM in sync with the resolved mode.
    useEffect(() => {
        applyToDocument(mode);
    }, [mode]);

    useEffect(() => {
        applyAccentToDocument(accent);
    }, [accent]);

    // Re-resolve whenever the preference changes, and keep tracking the OS while
    // the preference is "system".
    useEffect(() => {
        setMode(resolve(preference));

        if (preference !== "system" || typeof window.matchMedia !== "function") {
            return;
        }

        const query = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = (event: MediaQueryListEvent) => {
            setMode(event.matches ? "dark" : "light");
        };

        query.addEventListener("change", onChange);
        return () => query.removeEventListener("change", onChange);
    }, [preference]);

    const setPreference = useCallback((next: ColorModePreference) => {
        setPreferenceState(next);
        try {
            window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // Non-fatal: the choice just won't survive a reload.
        }
    }, []);

    const toggle = useCallback(() => {
        setPreference(mode === "dark" ? "light" : "dark");
    }, [mode, setPreference]);

    const setAccent = useCallback((next: AccentTheme) => {
        setAccentState(next);
        try {
            window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
        } catch {
            // Non-fatal: the choice just won't survive a reload.
        }
    }, []);

    const value = useMemo<ThemeContextValue>(
        () => ({ preference, mode, isDark: mode === "dark", setPreference, toggle, accent, setAccent }),
        [preference, mode, setPreference, toggle, accent, setAccent],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useColorMode = (): ThemeContextValue => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error("useColorMode must be used within a ThemeProvider");
    }
    return context;
};
