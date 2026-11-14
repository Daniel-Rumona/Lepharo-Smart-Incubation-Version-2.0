import React from "react";
import { theme } from "antd";

/**
 * A few months of revenue as a small inline line, for table rows. Plain SVG so
 * a long table doesn't build a chart per row.
 */
const Sparkline: React.FC<{ values: number[]; width?: number; height?: number }> = ({
    values,
    width = 72,
    height = 24,
}) => {
    const { token } = theme.useToken();

    if (values.length < 2) {
        return <span style={{ color: token.colorTextQuaternary }}>—</span>;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = 2;
    const points = values.map((value, i) => {
        const x = pad + (i / (values.length - 1)) * (width - pad * 2);
        const y = pad + (1 - (value - min) / span) * (height - pad * 2);
        return [x, y] as const;
    });

    const last = values[values.length - 1];
    const previous = values[values.length - 2];
    const color = last > previous ? token.colorSuccess : last < previous ? token.colorError : token.colorTextTertiary;
    const [endX, endY] = points[points.length - 1];

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: "block" }}>
            <polyline
                points={points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
            />
            <circle cx={endX} cy={endY} r={2} fill={color} />
        </svg>
    );
};

export default Sparkline;
