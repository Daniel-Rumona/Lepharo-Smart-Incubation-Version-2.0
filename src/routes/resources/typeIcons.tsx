import React from 'react'
import {
    AppstoreOutlined,
    CarOutlined,
    DesktopOutlined,
    HomeOutlined,
    InboxOutlined,
    LaptopOutlined,
    ToolOutlined
} from '@ant-design/icons'

// Types are user-defined, so match on keywords in the value with a generic fallback
const SPACE_TYPE_PATTERN = /room|hall|space|office|desk/

export const isSpaceType = (value: string) => SPACE_TYPE_PATTERN.test(value)

const TYPE_ICONS: [RegExp, React.ReactNode][] = [
    [SPACE_TYPE_PATTERN, <HomeOutlined />],
    [/vehicle|car|van|bus|truck/, <CarOutlined />],
    [/laptop|computer|pc/, <LaptopOutlined />],
    [/projector|screen|tv|display|monitor/, <DesktopOutlined />],
    [/chair|table|furniture/, <InboxOutlined />],
    [/equipment|tool|machine/, <ToolOutlined />]
]

export const getTypeIcon = (value: string) =>
    TYPE_ICONS.find(([pattern]) => pattern.test(value))?.[1] || <AppstoreOutlined />
