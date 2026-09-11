import React from 'react'
import { Col, Form, Row, Typography, type FormInstance } from 'antd'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import dayjs, { type Dayjs } from 'dayjs'
import 'dayjs/locale/en-gb'
import { useColorMode } from '@/contexts/ThemeContext'

const { Text } = Typography

/**
 * These pickers are MUI, not Ant Design, so they sit outside the app's
 * ConfigProvider and get none of its dark tokens. MUI needs its own theme with
 * palette.mode set, otherwise the popup calendar renders as a white sheet on a
 * dark modal and the typed value is near-black on near-black.
 */
const buildPickerTheme = (isDark: boolean) =>
    createTheme({
        palette: {
            mode: isDark ? 'dark' : 'light',
            primary: {
                main: '#fa8c16'
            },
            ...(isDark
                ? {
                    background: {
                        // Matches --app-surface-raised: the popup floats above
                        // the modal, so it takes the elevated rung.
                        paper: '#1f242d',
                        default: '#171b22'
                    },
                    text: {
                        primary: 'rgba(255, 255, 255, 0.88)',
                        secondary: 'rgba(255, 255, 255, 0.62)',
                        disabled: 'rgba(255, 255, 255, 0.30)'
                    },
                    divider: 'rgba(255, 255, 255, 0.12)'
                }
                : {})
        },
        shape: {
            borderRadius: 8
        },
        typography: {
            fontFamily: 'inherit'
        }
    })

const isOutsideSchedulingHours = (value: Dayjs, view: 'hours' | 'minutes' | 'seconds') =>
    view === 'hours' && (value.hour() < 6 || value.hour() > 18)

const handlePickerOnlyKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    openPicker: () => void
) => {
    if (event.key === 'Tab' || event.key === 'Escape') return

    event.preventDefault()
    if (event.key === 'Enter' || event.key === ' ') openPicker()
}

/**
 * The notched outline is hidden and replaced with a plain border so the field
 * matches Ant Design's inputs beside it. That border colour has to follow the
 * theme too — #d9d9d9 is invisible against a dark modal.
 */
const buildPickerTextFieldSx = (isDark: boolean) => ({
    '& .MuiPickersOutlinedInput-root': {
        minHeight: 42,
        border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.16)' : '#d9d9d9'}`,
        borderRadius: '8px',
        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
            borderColor: '#fa8c16'
        },
        '&.Mui-focused': {
            borderColor: '#fa8c16',
            boxShadow: '0 0 0 2px rgba(250, 140, 22, 0.14)'
        },
        '&.Mui-error': {
            borderColor: '#ff4d4f'
        },
        '&.Mui-disabled': {
            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.04)',
            borderColor: isDark ? 'rgba(255, 255, 255, 0.10)' : '#e5e5e5'
        }
    },
    '& .MuiPickersOutlinedInput-notchedOutline': {
        display: 'none'
    },
    '& .MuiPickersInputBase-sectionsContainer': {
        overflow: 'visible',
        alignItems: 'center',
        padding: '8px 0'
    },
    '& .MuiPickersSectionList-section, & .MuiPickersSectionList-sectionContent': {
        lineHeight: '22px'
    }
})

type Props = {
    form: FormInstance
    allowPast?: boolean
    /**
     * Locks both pickers. Used when a meeting has already left attendance or
     * coverage behind, so its slot must stay put while the rest of the form
     * remains editable.
     */
    disabled?: boolean
}

const AppointmentDateTimeFields: React.FC<Props> = ({ form, allowPast = false, disabled = false }) => {
    const startsAt = Form.useWatch('startsAt', form) as Dayjs | null | undefined
    const endsAt = Form.useWatch('endsAt', form) as Dayjs | null | undefined
    const [startPickerOpen, setStartPickerOpen] = React.useState(false)
    const [endPickerOpen, setEndPickerOpen] = React.useState(false)
    const { isDark } = useColorMode()

    // Rebuilding the MUI theme on every render would remount the picker's
    // styles and close the popup mid-interaction.
    const pickerTheme = React.useMemo(() => buildPickerTheme(isDark), [isDark])
    const pickerTextFieldSx = React.useMemo(() => buildPickerTextFieldSx(isDark), [isDark])

    return (
        <ThemeProvider theme={pickerTheme}>
            <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="en-gb">
                {/*
                    Row/Col rather than an auto-fit grid. `repeat(auto-fit,
                    minmax(240px, 1fr))` silently collapses to one column
                    whenever the container resolves narrower than 496px, which
                    is what stacked these inside the edit modal. A md breakpoint
                    is explicit about when they sit side by side.
                */}
                <Row gutter={16}>
                    <Col xs={24} md={12}>
                    <Form.Item
                        name="startsAt"
                        label="Starts"
                        rules={[
                            { required: true, message: 'Please select when the appointment starts.' },
                            {
                                validator: async (_, value: Dayjs | null) => {
                                    if (!value) return
                                    if (!dayjs(value).isValid()) throw new Error('Select a valid start date and time.')
                                    if (!allowPast && dayjs(value).isBefore(dayjs())) {
                                        throw new Error('The appointment must start in the future.')
                                    }
                                }
                            }
                        ]}
                    >
                        <DateTimePicker
                            ampm={false}
                            disabled={disabled}
                            disablePast={!allowPast}
                            format="DD MMM YYYY, HH:mm"
                            minutesStep={15}
                            open={startPickerOpen}
                            onClose={() => setStartPickerOpen(false)}
                            onOpen={() => setStartPickerOpen(true)}
                            openTo="day"
                            shouldDisableTime={isOutsideSchedulingHours}
                            skipDisabled
                            timeSteps={{ hours: 1, minutes: 15 }}
                            views={['year', 'day', 'hours', 'minutes']}
                            slotProps={{
                                textField: {
                                    fullWidth: true,
                                    sx: {
                                        ...pickerTextFieldSx,
                                        cursor: 'pointer',
                                        '& .MuiPickersSectionList-root, & .MuiIconButton-root': {
                                            cursor: 'pointer'
                                        }
                                    },
                                    onClick: () => setStartPickerOpen(true),
                                    onKeyDown: event => handlePickerOnlyKeyDown(event, () => setStartPickerOpen(true)),
                                    onPaste: event => event.preventDefault()
                                },
                                actionBar: { actions: ['clear', 'cancel', 'accept'] }
                            }}
                        />
                    </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                    <Form.Item
                        name="endsAt"
                        label="Ends"
                        dependencies={['startsAt']}
                        rules={[
                            { required: true, message: 'Please select when the appointment ends.' },
                            {
                                validator: async (_, value: Dayjs | null) => {
                                    if (!value) return
                                    const end = dayjs(value)
                                    const start = dayjs(form.getFieldValue('startsAt'))
                                    if (!end.isValid()) throw new Error('Select a valid end date and time.')
                                    if (start.isValid() && !end.isAfter(start)) {
                                        throw new Error('The end must be after the start.')
                                    }
                                    if (start.isValid() && !end.isSame(start, 'day')) {
                                        throw new Error('Start and end must be on the same day.')
                                    }
                                }
                            }
                        ]}
                    >
                        <DateTimePicker
                            ampm={false}
                            disabled={disabled}
                            disablePast={!allowPast}
                            format="DD MMM YYYY, HH:mm"
                            minDateTime={startsAt ? dayjs(startsAt).add(15, 'minute') : undefined}
                            minutesStep={15}
                            open={endPickerOpen}
                            onClose={() => setEndPickerOpen(false)}
                            onOpen={() => setEndPickerOpen(true)}
                            openTo="day"
                            shouldDisableTime={isOutsideSchedulingHours}
                            skipDisabled
                            timeSteps={{ hours: 1, minutes: 15 }}
                            views={['year', 'day', 'hours', 'minutes']}
                            slotProps={{
                                textField: {
                                    fullWidth: true,
                                    sx: {
                                        ...pickerTextFieldSx,
                                        cursor: 'pointer',
                                        '& .MuiPickersSectionList-root, & .MuiIconButton-root': {
                                            cursor: 'pointer'
                                        }
                                    },
                                    onClick: () => setEndPickerOpen(true),
                                    onKeyDown: event => handlePickerOnlyKeyDown(event, () => setEndPickerOpen(true)),
                                    onPaste: event => event.preventDefault()
                                },
                                actionBar: { actions: ['clear', 'cancel', 'accept'] }
                            }}
                        />
                    </Form.Item>
                    </Col>
                </Row>

                {startsAt && endsAt && dayjs(startsAt).isValid() && dayjs(endsAt).isValid() ? (
                    <div
                        style={{
                            marginTop: -8,
                            marginBottom: 20,
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: isDark ? 'rgba(250, 173, 20, 0.10)' : '#fff7e6',
                            border: `1px solid ${isDark ? 'rgba(250, 173, 20, 0.32)' : '#ffd591'}`
                        }}
                    >
                        <Text strong>{dayjs(startsAt).format('dddd, DD MMMM YYYY')}</Text>
                        <Text type="secondary">
                            {' · '}{dayjs(startsAt).format('HH:mm')}–{dayjs(endsAt).format('HH:mm')}
                        </Text>
                    </div>
                ) : null}
            </LocalizationProvider>
        </ThemeProvider>
    )
}

export default AppointmentDateTimeFields
