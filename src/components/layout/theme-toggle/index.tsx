import React from "react";
import { Button, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import {
    CheckOutlined,
    DesktopOutlined,
    MoonOutlined,
    SunOutlined,
} from "@ant-design/icons";
import { useColorMode, type ColorModePreference } from "@/contexts/ThemeContext";

const OPTIONS: { key: ColorModePreference; label: string; icon: React.ReactNode }[] = [
    { key: "light", label: "Light", icon: <SunOutlined /> },
    { key: "dark", label: "Dark", icon: <MoonOutlined /> },
    { key: "system", label: "System", icon: <DesktopOutlined /> },
];

/**
 * Topbar colour-mode control. A single button that opens a three-way menu, so
 * "match system" is as discoverable as the two explicit modes. The icon always
 * shows what is currently on screen, not what is selected — with "system" those
 * differ.
 */
export const ThemeToggle: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    const { preference, mode, isDark, setPreference } = useColorMode();

    const items: MenuProps["items"] = OPTIONS.map(({ key, label, icon }) => ({
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

    const tooltip =
        preference === "system" ? `Appearance: matching system (${mode})` : `Appearance: ${mode}`;

    return (
        <Dropdown
            menu={{
                items,
                selectable: true,
                selectedKeys: [preference],
                onClick: ({ key }) => setPreference(key as ColorModePreference),
            }}
            trigger={["click"]}
            placement="bottomRight"
        >
            <Tooltip title={tooltip}>
                <Button
                    type="text"
                    shape="circle"
                    className="workspace-theme-toggle"
                    icon={isDark ? <MoonOutlined /> : <SunOutlined />}
                    aria-label="Change appearance"
                    aria-haspopup="menu"
                />
            </Tooltip>
        </Dropdown>
    );
};

export default ThemeToggle;
