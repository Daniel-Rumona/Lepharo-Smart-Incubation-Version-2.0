import React from "react";
import { useWindowSize } from "react-use";
import { Button, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import {
    CheckOutlined,
    DesktopOutlined,
    MoonOutlined,
    SunOutlined,
} from "@ant-design/icons";
import {
    useColorMode,
    type AccentTheme,
    type ColorModePreference,
} from "@/contexts/ThemeContext";

export const MODE_OPTIONS: { key: ColorModePreference; label: string; icon: React.ReactNode }[] = [
    { key: "light", label: "Light", icon: <SunOutlined /> },
    { key: "dark", label: "Dark", icon: <MoonOutlined /> },
    { key: "system", label: "System", icon: <DesktopOutlined /> },
];

/**
 * Accent swatch colours, one pair per palette. Mirrors config/antdTheme.ts and
 * styles/accent-themes.css — kept in sync by hand since this is presentation
 * only (the actual theming happens in those two places).
 */
export const ACCENT_OPTIONS: { key: AccentTheme; label: string; light: string; dark: string }[] = [
    { key: "crimson", label: "Crimson", light: "#C8102E", dark: "#F0475A" },
    { key: "blue", label: "Blue", light: "#1677FF", dark: "#4a9bff" },
    { key: "ocean", label: "Ocean", light: "#0E9488", dark: "#2DD4BF" },
    { key: "violet", label: "Violet", light: "#7C3AED", dark: "#A78BFA" },
];

const Swatch: React.FC<{ color: string }> = ({ color }) => (
    <span
        style={{
            display: "inline-block",
            width: 12,
            height: 12,
            marginRight: 8,
            borderRadius: "50%",
            background: color,
            boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.12)",
        }}
    />
);

/**
 * The appearance choices as antd menu items, plus the click handler that
 * applies them: colour mode (light/dark/system) and accent palette. Shared by
 * ThemeToggle (sign-in screens) and the account menu (signed-in top bar), so
 * both offer exactly the same options.
 *
 * Item keys are prefixed (`mode:` / `accent:`) so a host menu can mix them
 * with its own items and still route clicks.
 */
export const useAppearanceMenu = (minWidth = 118) => {
    const { preference, isDark, setPreference, accent, setAccent } = useColorMode();

    const row = (label: string, checked: boolean) => (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                minWidth,
                justifyContent: "space-between",
            }}
        >
            {label}
            {checked ? <CheckOutlined style={{ fontSize: 12 }} /> : null}
        </span>
    );

    const items: NonNullable<MenuProps["items"]> = [
        { key: "appearance-label", label: "Appearance", type: "group" },
        ...MODE_OPTIONS.map(({ key, label, icon }) => ({
            key: `mode:${key}`,
            icon,
            label: row(label, preference === key),
        })),
        { type: "divider" },
        { key: "accent-label", label: "Colour", type: "group" },
        ...ACCENT_OPTIONS.map(({ key, label, light, dark }) => ({
            key: `accent:${key}`,
            icon: <Swatch color={isDark ? dark : light} />,
            label: row(label, accent === key),
        })),
    ];

    /** Applies the choice if the key is one of ours; returns whether it was. */
    const handleClick = (key: string): boolean => {
        const [kind, value] = key.split(":");
        if (kind === "mode" && MODE_OPTIONS.some(option => option.key === value)) {
            setPreference(value as ColorModePreference);
            return true;
        }
        if (kind === "accent" && ACCENT_OPTIONS.some(option => option.key === value)) {
            setAccent(value as AccentTheme);
            return true;
        }
        return false;
    };

    return { items, handleClick };
};

/**
 * Appearance control for screens without the account menu (sign-in and
 * registration). One button opens a menu with two independent choices: colour
 * mode and accent palette — the icon always reflects what's on screen.
 */
export const ThemeToggle: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    const { preference, mode, isDark } = useColorMode();
    const { items, handleClick } = useAppearanceMenu(compact ? 96 : 118);
    // Tooltips fire on tap on touch devices, and a Tooltip sitting behind the
    // Dropdown steals the first tap that should open the menu — the menu takes
    // a second tap instead. Skip it below the app's usual mobile breakpoint.
    const { width } = useWindowSize();
    const isMobile = width < 768;

    const tooltip =
        preference === "system" ? `Appearance: matching system (${mode})` : `Appearance: ${mode}`;

    const trigger = (
        <Button
            type="text"
            shape="circle"
            className="workspace-theme-toggle"
            icon={isDark ? <MoonOutlined /> : <SunOutlined />}
            aria-label="Change appearance"
            aria-haspopup="menu"
        />
    );

    return (
        <Dropdown
            menu={{ items, selectable: false, onClick: ({ key }) => handleClick(key) }}
            trigger={["click"]}
            placement="bottomRight"
        >
            {isMobile ? trigger : <Tooltip title={tooltip}>{trigger}</Tooltip>}
        </Dropdown>
    );
};

export default ThemeToggle;
