import React, { useEffect, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { Image } from 'antd'
import type { CoverageReviewPhoto } from '@/lib/coveragePhotos'

const controlStyle: React.CSSProperties = {
    border: '1px solid rgba(255,255,255,0.5)', borderRadius: 8,
    background: 'rgba(0,0,0,0.15)', color: '#fff', cursor: 'pointer',
    minWidth: 40, height: 32, fontSize: 20
}

const CoverageStoryCarousel: React.FC<{ photos: CoverageReviewPhoto[] }> = ({ photos }) => {
    const [index, setIndex] = useState(0)
    const [previewOpen, setPreviewOpen] = useState(false)
    const touchStart = useRef<number | null>(null)
    useEffect(() => { setIndex(0) }, [photos])
    const activeIndex = Math.min(index, Math.max(0, photos.length - 1))
    const photo = photos[activeIndex]
    const move = (direction: number) => {
        if (photos.length > 1) setIndex((activeIndex + direction + photos.length) % photos.length)
    }

    if (!photo) return <p style={{ margin: 0 }}>No coverage images saved for this period.</p>

    return (
        <section
            aria-label='Coverage images'
            aria-roledescription='carousel'
            tabIndex={0}
            style={{ width: '100%', minWidth: 0, touchAction: 'pan-y' }}
            onKeyDown={event => {
                if (previewOpen) {
                    event.stopPropagation()
                    return
                }
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                event.stopPropagation()
                move(event.key === 'ArrowLeft' ? -1 : 1)
            }}
            onTouchStart={event => { touchStart.current = previewOpen ? null : event.touches[0]?.clientX ?? null }}
            onTouchEnd={event => {
                const end = event.changedTouches[0]?.clientX
                if (touchStart.current !== null && end !== undefined && Math.abs(end - touchStart.current) > 40) {
                    move(end < touchStart.current ? 1 : -1)
                }
                touchStart.current = null
            }}
            onTouchCancel={() => { touchStart.current = null }}
        >
            <figure style={{ margin: 0 }}>
                <button
                    type='button'
                    aria-label={`Enlarge coverage image ${activeIndex + 1} for ${photo.title}`}
                    onClick={() => setPreviewOpen(true)}
                    style={{ display: 'block', width: '100%', border: 0, padding: 0, background: 'transparent', cursor: 'zoom-in', borderRadius: 10 }}
                >
                    <img
                        src={photo.url}
                        alt={`Coverage image ${activeIndex + 1} for ${photo.title}`}
                        style={{ display: 'block', width: '100%', height: 184, objectFit: 'contain', borderRadius: 10, background: 'rgba(0,0,0,0.2)' }}
                    />
                </button>
                <Image.PreviewGroup
                    items={photos.map(item => item.url)}
                    preview={{
                        visible: previewOpen,
                        current: activeIndex,
                        onVisibleChange: setPreviewOpen,
                        onChange: setIndex
                    }}
                />
                <figcaption
                    title={photo.title}
                    style={{ height: 32, lineHeight: '16px', fontSize: 12, marginTop: 6, overflow: 'hidden' }}
                >
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{photo.title}</div>
                    {photo.date ? dayjs(photo.date).format('DD MMM YYYY') : ''}
                </figcaption>
            </figure>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, height: 32, marginTop: 4 }}>
                {photos.length > 1 ? <button type='button' aria-label='Previous coverage image' style={controlStyle} onClick={() => move(-1)}>‹</button> : null}
                <span aria-live='polite' aria-atomic='true' style={{ fontSize: 12 }}>{activeIndex + 1} / {photos.length}</span>
                {photos.length > 1 ? <button type='button' aria-label='Next coverage image' style={controlStyle} onClick={() => move(1)}>›</button> : null}
            </div>
        </section>
    )
}

export default CoverageStoryCarousel
