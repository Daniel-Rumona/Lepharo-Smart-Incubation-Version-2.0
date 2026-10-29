import React from 'react'

/**
 * A tick drawn to sit at the optical centre of a round badge. antd's
 * CheckOutlined is centred in its own box, but its inline-icon wrapper rides a
 * few pixels high inside a small circle; a block-level SVG has no baseline to
 * drift on.
 */
export const TickMark: React.FC = () => (
    <svg viewBox='0 0 24 24' width='12' height='12' aria-hidden='true' style={{ display: 'block' }}>
        <path
            d='M5 12.5l4.5 4.5L19 7.5'
            fill='none'
            stroke='currentColor'
            strokeWidth='2.6'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
)

export default TickMark
