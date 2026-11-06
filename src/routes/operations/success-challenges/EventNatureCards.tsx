import { CustomerServiceOutlined, GlobalOutlined, TeamOutlined } from '@ant-design/icons'

export type EventNature = 'In person' | 'Online' | 'Telephonic'

const options: Array<{ value: EventNature; icon: React.ReactNode; tone: string; description: string }> = [
    { value: 'In person', icon: <TeamOutlined />, tone: 'green', description: 'Held face to face' },
    { value: 'Online', icon: <GlobalOutlined />, tone: 'blue', description: 'Virtual meeting or webinar' },
    { value: 'Telephonic', icon: <CustomerServiceOutlined />, tone: 'gold', description: 'Held over a phone call' }
]

/** Maps a recorded event's `format` field onto the nature options. */
export const natureFromFormat = (format?: string): EventNature | undefined => {
    const value = String(format || '').toLowerCase()
    if (['virtual', 'online'].includes(value)) return 'Online'
    if (['in-person', 'in_person', 'in person', 'physical'].includes(value)) return 'In person'
    if (['telephonic', 'phone', 'telephone', 'call'].includes(value)) return 'Telephonic'
    return undefined
}

/** Row of selectable cards for the nature of an event. Used as an antd Form control. */
const EventNatureCards: React.FC<{ value?: EventNature; onChange?: (value: EventNature) => void }> = ({ value, onChange }) => (
    <div className='status-cards checkin-outcomes' role='radiogroup' aria-label='Nature of the event'>
        {options.map(option => (
            <button key={option.value} type='button' role='radio' aria-checked={value === option.value} onClick={() => onChange?.(option.value)} className={`status-card status-card-${option.tone}${value === option.value ? ' status-card-active' : ''}`}>
                <span className='status-card-icon'>{option.icon}</span>
                <span className='checkin-outcome-copy'>
                    <span className='status-card-label'>{option.value}</span>
                    <small>{option.description}</small>
                </span>
            </button>
        ))}
    </div>
)

export default EventNatureCards
