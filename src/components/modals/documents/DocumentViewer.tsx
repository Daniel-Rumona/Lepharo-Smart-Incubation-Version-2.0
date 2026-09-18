import React, {
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import {
    Button,
    Grid,
    Space,
    Spin,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    MinusOutlined,
    PlusOutlined
} from '@ant-design/icons'
import {
    AnimatePresence,
    motion
} from 'framer-motion'
import {
    Document,
    Page,
    pdfjs
} from 'react-pdf'

import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc =
    new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
    ).toString()

const { Text } = Typography

type Props = {
    file: string
    fileName?: string
}

const DocumentViewer: React.FC<Props> = ({
    file,
    fileName
}) => {
    const { token } =
        theme.useToken()

    const screens =
        Grid.useBreakpoint()

    const isMobile =
        !screens.md

    const pageContainerRef =
        useRef<HTMLDivElement | null>(
            null
        )

    const [
        pageCount,
        setPageCount
    ] = useState(0)

    const [
        pageNumber,
        setPageNumber
    ] = useState(1)

    const [
        direction,
        setDirection
    ] = useState<1 | -1>(1)

    const [
        zoom,
        setZoom
    ] = useState(1)

    const [
        containerWidth,
        setContainerWidth
    ] = useState(0)

    useEffect(() => {
        setPageNumber(1)
        setZoom(1)
    }, [file])

    useEffect(() => {
        const element =
            pageContainerRef.current

        if (!element) {
            return
        }

        const updateWidth = () => {
            setContainerWidth(
                element.clientWidth
            )
        }

        updateWidth()

        const observer =
            new ResizeObserver(
                updateWidth
            )

        observer.observe(
            element
        )

        return () => {
            observer.disconnect()
        }
    }, [])

    const fittedPageWidth =
        useMemo(() => {
            if (!containerWidth) {
                return undefined
            }

            const horizontalPadding =
                isMobile
                    ? 20
                    : 48

            return Math.max(
                220,
                containerWidth -
                horizontalPadding
            )
        }, [
            containerWidth,
            isMobile
        ])

    const goPrevious = () => {
        if (
            pageNumber <= 1
        ) {
            return
        }

        setDirection(-1)

        setPageNumber(
            previous =>
                previous - 1
        )
    }

    const goNext = () => {
        if (
            pageNumber >=
            pageCount
        ) {
            return
        }

        setDirection(1)

        setPageNumber(
            previous =>
                previous + 1
        )
    }

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: isMobile
                    ? '76vh'
                    : '72vh',
                minHeight: isMobile
                    ? 460
                    : 520,
                borderRadius: isMobile
                    ? 12
                    : 16,
                overflow: 'hidden',
                border: `1px solid ${token.colorBorderSecondary}`,
                background:
                    token.colorFillAlter
            }}
        >
            {/* TOOLBAR */}
            <div
                style={{
                    minHeight: 52,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent:
                        'space-between',
                    gap: 8,
                    padding: isMobile
                        ? '7px 9px'
                        : '8px 12px',
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    background:
                        token.colorBgContainer
                }}
            >
                <div
                    style={{
                        minWidth: 0,
                        flex: 1
                    }}
                >
                    <Text
                        strong
                        ellipsis={{
                            tooltip:
                                fileName ||
                                'Document'
                        }}
                        style={{
                            display: 'block',
                            fontSize:
                                isMobile
                                    ? 11
                                    : 13
                        }}
                    >
                        {fileName ||
                            'Document'}
                    </Text>

                    {pageCount > 0 ? (
                        <Text
                            type='secondary'
                            style={{
                                display:
                                    'block',
                                fontSize: 10
                            }}
                        >
                            {pageCount}{' '}
                            {pageCount === 1
                                ? 'page'
                                : 'pages'}
                        </Text>
                    ) : null}
                </div>

                <Space
                    size={4}
                    style={{
                        flex:
                            '0 0 auto'
                    }}
                >
                    <Button
                        shape='circle'
                        size='small'
                        icon={
                            <MinusOutlined />
                        }
                        disabled={
                            zoom <= 0.7
                        }
                        onClick={() =>
                            setZoom(
                                previous =>
                                    Math.max(
                                        0.7,
                                        Number(
                                            (
                                                previous -
                                                0.1
                                            ).toFixed(
                                                1
                                            )
                                        )
                                    )
                            )
                        }
                    />

                    <Tag
                        style={{
                            margin: 0,
                            minWidth: 48,
                            textAlign:
                                'center',
                            borderRadius: 999
                        }}
                    >
                        {Math.round(
                            zoom * 100
                        )}
                        %
                    </Tag>

                    <Button
                        shape='circle'
                        size='small'
                        icon={
                            <PlusOutlined />
                        }
                        disabled={
                            zoom >= 2
                        }
                        onClick={() =>
                            setZoom(
                                previous =>
                                    Math.min(
                                        2,
                                        Number(
                                            (
                                                previous +
                                                0.1
                                            ).toFixed(
                                                1
                                            )
                                        )
                                    )
                            )
                        }
                    />
                </Space>
            </div>

            {/* DOCUMENT AREA */}
            <div
                ref={
                    pageContainerRef
                }
                style={{
                    position:
                        'relative',
                    flex: 1,
                    minHeight: 0,
                    overflow: 'auto',
                    background:
                        token.colorFillSecondary,
                    WebkitOverflowScrolling:
                        'touch'
                }}
            >
                {/* PREVIOUS FLOATING BUTTON */}
                <Button
                    type='primary'
                    shape='circle'
                    icon={
                        <ArrowLeftOutlined />
                    }
                    disabled={
                        pageNumber <= 1
                    }
                    onClick={
                        goPrevious
                    }
                    style={{
                        position:
                            'absolute',
                        left:
                            isMobile
                                ? 7
                                : 12,
                        top: '50%',
                        transform:
                            'translateY(-50%)',
                        zIndex: 10,
                        opacity:
                            pageNumber <= 1
                                ? 0.35
                                : 0.78,
                        boxShadow:
                            '0 6px 20px rgba(0,0,0,.18)'
                    }}
                />

                {/* NEXT FLOATING BUTTON */}
                <Button
                    type='primary'
                    shape='circle'
                    icon={
                        <ArrowRightOutlined />
                    }
                    disabled={
                        pageNumber >=
                        pageCount
                    }
                    onClick={
                        goNext
                    }
                    style={{
                        position:
                            'absolute',
                        right:
                            isMobile
                                ? 7
                                : 12,
                        top: '50%',
                        transform:
                            'translateY(-50%)',
                        zIndex: 10,
                        opacity:
                            pageNumber >=
                                pageCount
                                ? 0.35
                                : 0.78,
                        boxShadow:
                            '0 6px 20px rgba(0,0,0,.18)'
                    }}
                />

                <div
                    style={{
                        minHeight:
                            '100%',
                        width: '100%',
                        display: 'flex',
                        justifyContent:
                            'center',
                        alignItems:
                            'flex-start',
                        padding: isMobile
                            ? '10px'
                            : '22px'
                    }}
                >
                    <Document
                        file={file}
                        loading={
                            <div
                                style={{
                                    minHeight:
                                        360,
                                    display:
                                        'grid',
                                    placeItems:
                                        'center'
                                }}
                            >
                                <Spin />
                            </div>
                        }
                        onLoadSuccess={document => {
                            setPageCount(
                                document.numPages
                            )

                            setPageNumber(
                                previous =>
                                    Math.min(
                                        Math.max(
                                            1,
                                            previous
                                        ),
                                        document.numPages
                                    )
                            )
                        }}
                    >
                        <AnimatePresence
                            mode='wait'
                            initial={false}
                            custom={
                                direction
                            }
                        >
                            <motion.div
                                key={
                                    pageNumber
                                }
                                custom={
                                    direction
                                }
                                initial={{
                                    opacity: 0,
                                    x:
                                        direction ===
                                            1
                                            ? 40
                                            : -40
                                }}
                                animate={{
                                    opacity: 1,
                                    x: 0
                                }}
                                exit={{
                                    opacity: 0,
                                    x:
                                        direction ===
                                            1
                                            ? -40
                                            : 40
                                }}
                                transition={{
                                    duration:
                                        0.2,
                                    ease:
                                        'easeOut'
                                }}
                                style={{
                                    display:
                                        'flex',
                                    justifyContent:
                                        'center',
                                    boxShadow:
                                        '0 10px 30px rgba(15,23,42,.16)'
                                }}
                            >
                                {fittedPageWidth ? (
                                    <Page
                                        pageNumber={
                                            pageNumber
                                        }
                                        width={
                                            fittedPageWidth
                                        }
                                        scale={
                                            zoom
                                        }
                                        renderTextLayer
                                        renderAnnotationLayer
                                    />
                                ) : null}
                            </motion.div>
                        </AnimatePresence>
                    </Document>
                </div>
            </div>

            {/* FOOTER */}
            <div
                style={{
                    minHeight: isMobile
                        ? 48
                        : 54,
                    display: 'grid',
                    gridTemplateColumns:
                        '1fr auto 1fr',
                    alignItems:
                        'center',
                    gap: 8,
                    padding: isMobile
                        ? '6px 8px'
                        : '8px 14px',
                    borderTop: `1px solid ${token.colorBorderSecondary}`,
                    background:
                        token.colorBgContainer
                }}
            >
                <Button
                    shape='round'
                    size={
                        isMobile
                            ? 'small'
                            : 'middle'
                    }
                    icon={
                        <ArrowLeftOutlined />
                    }
                    disabled={
                        pageNumber <= 1
                    }
                    onClick={
                        goPrevious
                    }
                    style={{
                        justifySelf:
                            'start'
                    }}
                >
                    {!isMobile
                        ? 'Previous'
                        : null}
                </Button>

                <Tag
                    style={{
                        margin: 0,
                        borderRadius: 999,
                        fontWeight: 600
                    }}
                >
                    {pageNumber} /{' '}
                    {pageCount || 1}
                </Tag>

                <Button
                    type='primary'
                    shape='round'
                    size={
                        isMobile
                            ? 'small'
                            : 'middle'
                    }
                    disabled={
                        pageNumber >=
                        pageCount
                    }
                    onClick={
                        goNext
                    }
                    style={{
                        justifySelf:
                            'end'
                    }}
                >
                    {!isMobile
                        ? 'Next'
                        : null}

                    <ArrowRightOutlined />
                </Button>
            </div>

            <style>{`
                .react-pdf__Page {
                    max-width: 100%;
                }

                .react-pdf__Page__canvas {
                    max-width: 100%;
                    height: auto !important;
                }

                @media (max-width: 767px) {
                    .react-pdf__Page {
                        margin: 0 auto;
                    }
                }
            `}</style>
        </div>
    )
}

export default DocumentViewer
