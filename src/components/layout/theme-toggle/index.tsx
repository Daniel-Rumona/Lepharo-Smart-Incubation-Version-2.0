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

const MODE_OPTIONS: { key: ColorModePreference; label: string; icon: React.ReactNode }[] = [
    { key: "light", label: "Light", icon: <SunOutlined /> },
    { key: "dark", label: "Dark", icon: <MoonOutlined /> },
    { key: "system", label: "System", icon: <DesktopOutlined /> },
];

/**
 * Accent swatch colours, one pair per palette. Mirrors config/antdTheme.ts and
 * styles/accent-themes.css — kept in sync by hand since this is presentation
 * only (the actual theming happens in those two places).
 */
const ACCENT_OPTIONS: { key: AccentTheme; label: string; light: string; dark: string }[] = [
    { key: "blue", label: "Blue", light: "#1677FF", dark: "#4A9BFF" },
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
 * Topbar appearance control. One button opens a menu with two independent
 * choices: colour mode (light/dark/system) and accent palette (blue/ocean/
 * violet) — the icon always reflects what's on screen, the accent swatch
 * reflects the chosen palette in that mode.
 */
export const ThemeToggle: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    const { preference, mode, isDark, setPreference, accent, setAccent } = useColorMode();
    // Tooltips fire on tap on touch devices, and a Tooltip sitting behind the
    // Dropdown steals the first tap that should open the menu — the menu takes
    // a second tap instead. Skip it below the app's usual mobile breakpoint.
    const { width } = useWindowSize();
    const isMobile = width < 768;

    const modeItems: MenuProps["items"] = MODE_OPTIONS.map(({ key, label, icon }) => ({
        key,
        icon,
        label: (
            <span
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 12,
                    minWidth: compact ? 96 : 118,
                    justifyContent: "space-between",
                }}
            >
                {label}
                {preference === key ? <CheckOutlined style={{ fontSize: 12 }} /> : null}
            </span>
        ),
    }));

    const accentItems: MenuProps["items"] = ACCENT_OPTIONS.map(({ key, label, light, dark }) => ({
        key,
        icon: <Swatch color={isDark ? dark : light} />,
        label: (
            <span
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 12,
                    minWidth: compact ? 96 : 118,
                    justifyContent: "space-between",
                }}
            >
                {label}
                {accent === key ? <CheckOutlined style={{ fontSize: 12 }} /> : null}
            </span>
        ),
    }));

    const items: MenuProps["items"] = [
        { key: "appearance-label", label: "Appearance", type: "group" },
        ...modeItems,
        { type: "divider" },
        { key: "accent-label", label: "Colour", type: "group" },
        ...accentItems,
    ];

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
            menu={{
                items,
                selectable: false,
                onClick: ({ key }) => {
                    if (key === "light" || key === "dark" || key === "system") {
                        setPreference(key);
                        return;
                    }
                    if (key === "blue" || key === "ocean" || key === "violet") {
                        setAccent(key);
                    }
                },
            }}
            trigger={["click"]}
            placement="bottomRight"
        >
            {isMobile ? trigger : <Tooltip title={tooltip}>{trigger}</Tooltip>}
        </Dropdown>
    );
};

export default ThemeToggle;
