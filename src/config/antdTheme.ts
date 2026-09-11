import { theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";
import type { ResolvedColorMode } from "@/contexts/ThemeContext";

/**
 * Brand accent. Matches the RefineThemes.Blue primary the app shipped with, so
 * light mode is unchanged. Dark mode lifts it a couple of steps because a mid
 * blue reads as muddy against a dark surface.
 */
const PRIMARY_LIGHT = "#1677FF";
const PRIMARY_DARK = "#4A9BFF";

/**
 * Dark surface ramp. Deliberately a desaturated blue-grey rather than pure black:
 * pure black plus AntD's shadows produces the "floating grey boxes" look, and
 * neutral greys make the blue accent look dirty. Each step is a real elevation
 * level so nested cards stay distinguishable.
 */
const DARK_SURFACE = {
    /** Page background — the furthest back plane. */
    layout: "#0E1117",
    /** Cards, tables, inputs — the default panel. */
    container: "#171B22",
    /** Modals, dropdowns, popovers — anything floating above a panel. */
    elevated: "#1F242D",
    /** Hairlines between sections. */
    border: "#2A313C",
    /** Stronger dividers and input outlines. */
    borderSecondary: "#222831",
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

const lightTheme: ThemeConfig = {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
        ...sharedToken,
        colorPrimary: PRIMARY_LIGHT,
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
            headerBg: "#1C222B",
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
            colorBgSpotlight: "#2C333E",
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

export const getAntdTheme = (mode: ResolvedColorMode): ThemeConfig =>
    mode === "dark" ? darkTheme : lightTheme;

export { PRIMARY_LIGHT, PRIMARY_DARK, DARK_SURFACE, DARK_TEXT };
