import React from "react";
import { ConfigProvider } from "antd";
import { getAntdTheme } from "@/config/antdTheme";

/**
 * Pins a subtree to light mode regardless of the app-wide colour mode.
 *
 * Two things have to happen together for that to actually look right, which is
 * why this is a component rather than a CSS class:
 *   - `keep-light` opts the subtree out of the dark CSS in styles/dark-mode.css
 *   - the nested ConfigProvider hands Ant Design light tokens, so Inputs, Selects
 *     and Buttons inside don't render dark-on-light
 *
 * Currently unused: the landing, sign-in and registration pages were pinned
 * light at first and now follow the app theme instead. It is kept as the
 * documented escape hatch for surfaces that must stay light whatever the mode —
 * document and contract previews being the obvious candidates, since they are
 * previews of something that will be printed on white paper.
 */
export const LightSurface: React.FC<{
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    /** Render without a wrapper element — only the theme is scoped. */
    asFragment?: boolean;
}> = ({ children, className, style, asFragment = false }) => (
    <ConfigProvider theme={getAntdTheme("light")}>
        {asFragment ? (
            children
        ) : (
            <div className={className ? `keep-light ${className}` : "keep-light"} style={style}>
                {children}
            </div>
        )}
    </ConfigProvider>
);

export default LightSurface;
