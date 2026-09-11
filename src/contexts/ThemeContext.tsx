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

type ThemeContextValue = {
    /** What the user picked. */
    preference: ColorModePreference;
    /** What is on screen. */
    mode: ResolvedColorMode;
    isDark: boolean;
    setPreference: (next: ColorModePreference) => void;
    /** Flips between light and dark, dropping "system" in the process. */
    toggle: () => void;
};

const STORAGE_KEY = "lph-color-mode";
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

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [preference, setPreferenceState] = useState<ColorModePreference>(readStoredPreference);
    const [mode, setMode] = useState<ResolvedColorMode>(() => resolve(readStoredPreference()));

    // Keep the DOM in sync with the resolved mode.
    useEffect(() => {
        applyToDocument(mode);
    }, [mode]);

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

    const value = useMemo<ThemeContextValue>(
        () => ({ preference, mode, isDark: mode === "dark", setPreference, toggle }),
        [preference, mode, setPreference, toggle],
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
