import { theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";
import type { AccentTheme, ResolvedColorMode } from "@/contexts/ThemeContext";

/**
 * Brand accent. Matches the RefineThemes.Blue primary the app shipped with, so
 * light mode is unchanged. Dark mode lifts it a couple of steps because a mid
 * blue reads as muddy against a dark surface.
 */
const PRIMARY_LIGHT = "#1677FF";
const PRIMARY_DARK = "#4a9bff";

/**
 * Per-accent primaries, one pair per colour mode. Mirrors the CSS custom
 * properties in styles/dark-mode.css and styles/accent-themes.css, so Ant
 * Design's own tokens (buttons, checkboxes, switches, links, active tabs, …)
 * track whichever accent is selected instead of only the hand-written chrome.
 */
const ACCENT_PRIMARY: Record<AccentTheme, { light: string; dark: string }> = {
    // Lepharo brand red, as on the landing and sign-in screens.
    crimson: { light: "#C8102E", dark: "#F0475A" },
    blue: { light: PRIMARY_LIGHT, dark: PRIMARY_DARK },
    ocean: { light: "#0E9488", dark: "#2DD4BF" },
    violet: { light: "#7C3AED", dark: "#A78BFA" },
};

/**
 * Dark surface ramp. Deliberately a desaturated blue-grey rather than pure black:
 * pure black plus AntD's shadows produces the "floating grey boxes" look, and
 * neutral greys make the blue accent look dirty. Each step is a real elevation
 * level so nested cards stay distinguishable.
 */
const DARK_SURFACE = {
    /** Page background — the furthest back plane. */
    layout: "#1e2024",
    /** Cards, tables, inputs — the default panel. */
    container: "#26292e",
    /** Modals, dropdowns, popovers — anything floating above a panel. */
    elevated: "#2e3238",
    /** Hairlines between sections. */
    border: "#3b4047",
    /** Stronger dividers and input outlines. */
    borderSecondary: "#33373d",
    /** Hover/active wash on list rows and menu items. */
    fill: "rgba(255, 255, 255, 0.08)",
    fillSecondary: "rgba(255, 255, 255, 0.05)",
    fillTertiary: "rgba(255, 255, 255, 0.035)",
    fillQuaternary: "rgba(255, 255, 255, 0.02)",
};

/**
 * Text ramp. 0.88 rather than pure white for body copy — full white on a dark
 * panel vibrates and looks harsh at paragraph length.
 */
const DARK_TEXT = {
    primary: "rgba(255, 255, 255, 0.88)",
    secondary: "rgba(255, 255, 255, 0.62)",
    tertiary: "rgba(255, 255, 255, 0.42)",
    quaternary: "rgba(255, 255, 255, 0.26)",
};

const sharedToken: ThemeConfig["token"] = {
    borderRadius: 6,
    fontSize: 14,
};

/**
 * One button shape for the whole app — pages, tables, modals and drawers
 * alike: a pill (icon-only buttons become circles), semibold label, roomier
 * padding. Shadows are zeroed here because styles/buttons.css owns elevation,
 * so light and dark mode get the same treatment from one place.
 */
const buttonComponent: NonNullable<ThemeConfig["components"]>["Button"] = {
    borderRadius: 999,
    borderRadiusLG: 999,
    borderRadiusSM: 999,
    fontWeight: 600,
    paddingInline: 18,
    paddingInlineLG: 22,
    paddingInlineSM: 12,
    defaultShadow: "none",
    primaryShadow: "none",
    dangerShadow: "none",
};

const lightTheme: ThemeConfig = {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
        ...sharedToken,
        colorPrimary: PRIMARY_LIGHT,
    },
    components: {
        Button: buttonComponent,
    },
};

const darkTheme: ThemeConfig = {
    algorithm: antdTheme.darkAlgorithm,
    token: {
        ...sharedToken,
        colorPrimary: PRIMARY_DARK,

        // Status colours, nudged brighter so they clear the dark background.
        colorSuccess: "#5BC85B",
        colorWarning: "#F5B942",
        colorError: "#FF6B6B",
        colorInfo: PRIMARY_DARK,

        // Surfaces.
        colorBgLayout: DARK_SURFACE.layout,
        colorBgContainer: DARK_SURFACE.container,
        colorBgElevated: DARK_SURFACE.elevated,
        colorBgSpotlight: DARK_SURFACE.elevated,
        colorBorder: DARK_SURFACE.border,
        colorBorderSecondary: DARK_SURFACE.borderSecondary,
        colorFill: DARK_SURFACE.fill,
        colorFillSecondary: DARK_SURFACE.fillSecondary,
        colorFillTertiary: DARK_SURFACE.fillTertiary,
        colorFillQuaternary: DARK_SURFACE.fillQuaternary,

        // Text.
        colorText: DARK_TEXT.primary,
        colorTextSecondary: DARK_TEXT.secondary,
        colorTextTertiary: DARK_TEXT.tertiary,
        colorTextQuaternary: DARK_TEXT.quaternary,

        // AntD's default dark shadows are tuned for a lighter backdrop and read as
        // grey halos here; heavier and tighter keeps elevation legible instead.
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.45)",
        boxShadowSecondary: "0 6px 20px rgba(0, 0, 0, 0.55)",
    },
    components: {
        Button: buttonComponent,
        Layout: {
            bodyBg: DARK_SURFACE.layout,
            headerBg: DARK_SURFACE.container,
            siderBg: DARK_SURFACE.container,
            footerBg: DARK_SURFACE.layout,
            triggerBg: DARK_SURFACE.elevated,
        },
        Menu: {
            itemBg: "transparent",
            subMenuItemBg: "transparent",
            popupBg: DARK_SURFACE.elevated,
        },
        Card: {
            colorBgContainer: DARK_SURFACE.container,
        },
        Table: {
            headerBg: "#2a2e34",
            headerSplitColor: DARK_SURFACE.border,
            rowHoverBg: DARK_SURFACE.fillTertiary,
            borderColor: DARK_SURFACE.borderSecondary,
        },
        Modal: {
            contentBg: DARK_SURFACE.elevated,
            headerBg: DARK_SURFACE.elevated,
            footerBg: "transparent",
        },
        Drawer: {
            colorBgElevated: DARK_SURFACE.elevated,
        },
        Tooltip: {
            colorBgSpotlight: "#383d44",
            colorTextLightSolid: DARK_TEXT.primary,
        },
        Select: {
            optionSelectedBg: DARK_SURFACE.fill,
        },
        Segmented: {
            itemSelectedBg: DARK_SURFACE.fill,
            trackBg: DARK_SURFACE.fillQuaternary,
        },
        Tabs: {
            cardBg: DARK_SURFACE.fillQuaternary,
        },
        Collapse: {
            headerBg: DARK_SURFACE.fillQuaternary,
            contentBg: "transparent",
        },
    },
};

export const getAntdTheme = (
    mode: ResolvedColorMode,
    accent: AccentTheme = "crimson",
): ThemeConfig => {
    const primary = mode === "dark" ? ACCENT_PRIMARY[accent].dark : ACCENT_PRIMARY[accent].light;
    const base = mode === "dark" ? darkTheme : lightTheme;

    return {
        ...base,
        token: {
            ...base.token,
            colorPrimary: primary,
            // Text links follow the accent in both modes (dark mode already did via colorInfo).
            colorLink: primary,
            ...(mode === "dark" ? { colorInfo: primary } : null),
        },
        components: {
            ...base.components,
            // Link buttons follow the accent like every other button; antd
            // otherwise derives them from colorInfo, which stays blue.
            Button: {
                ...buttonComponent,
                colorLink: primary,
                colorLinkHover: primary,
                colorLinkActive: primary,
            },
        },
    };
};

export { PRIMARY_LIGHT, PRIMARY_DARK, DARK_SURFACE, DARK_TEXT, ACCENT_PRIMARY };
