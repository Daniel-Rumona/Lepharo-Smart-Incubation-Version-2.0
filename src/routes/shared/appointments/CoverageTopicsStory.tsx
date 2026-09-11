import React, { useEffect, useState } from 'react'

type Topic = { topic: string; count: number }
export const COVERAGE_TOPICS_PER_PAGE = 4

const CoverageTopicsStory: React.FC<{ topics: Topic[] }> = ({ topics }) => {
    const [page, setPage] = useState(0)
    useEffect(() => { setPage(0) }, [topics])
    const pageCount = Math.max(1, Math.ceil(topics.length / COVERAGE_TOPICS_PER_PAGE))
    const current = Math.min(page, pageCount - 1)
    const visible = topics.slice(current * COVERAGE_TOPICS_PER_PAGE, (current + 1) * COVERAGE_TOPICS_PER_PAGE)
    const move = (delta: number) => setPage((current + delta + pageCount) % pageCount)
    const buttonStyle: React.CSSProperties = { background: 'rgba(0,0,0,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.5)', borderRadius: 8, minWidth: 40, height: 32, cursor: 'pointer' }

    return (
        <section aria-label='Coverage topics' tabIndex={0} style={{ width: '100%', maxWidth: 640 }} onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            event.stopPropagation()
            move(event.key === 'ArrowLeft' ? -1 : 1)
        }}>
            <h3 style={{ margin: '0 0 16px', color: '#fff', fontSize: 22 }}>Coverage topics</h3>
            <ul style={{ padding: 0, margin: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                {visible.map(item => (
                    <li key={item.topic} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.16)', borderRadius: 10, padding: '10px 12px', textAlign: 'left' }}>
                        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 14, lineHeight: '20px' }}>{item.topic}</span>
                        <span style={{ flexShrink: 0, fontSize: 12 }}>{item.count} {item.count === 1 ? 'session' : 'sessions'}</span>
                    </li>
                ))}
            </ul>
            {!topics.length ? <p>No formal topics recorded.</p> : null}
            {pageCount > 1 ? (
                <nav aria-label='Coverage topic pages' style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 14 }}>
                    <button type='button' aria-label='Previous topics' style={buttonStyle} onClick={() => move(-1)}>‹</button>
                    <span aria-live='polite' style={{ fontSize: 12 }}>Page {current + 1} of {pageCount}</span>
                    <button type='button' aria-label='Next topics' style={buttonStyle} onClick={() => move(1)}>›</button>
                </nav>
            ) : null}
        </section>
    )
}

export default CoverageTopicsStory
