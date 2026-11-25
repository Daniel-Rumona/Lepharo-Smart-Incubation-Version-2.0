import React from 'react'
import { Button, Input, Segmented } from 'antd'
import { BarChartOutlined, FileTextOutlined, PlusOutlined, SearchOutlined, SendOutlined } from '@ant-design/icons'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'

export type PortalView = 'sent' | 'templates'
export type SentSort = 'newest' | 'due' | 'response' | 'title'
export type TemplateSort = 'updated' | 'title'

export type PortalFilters = {
    view: PortalView
    search: string
    sentStatus: 'all' | 'pending' | 'completed' | 'closed'
    templateStatus: 'all' | 'published' | 'draft' | 'archived'
    sentSort: SentSort
    templateSort: TemplateSort
}

export const DEFAULT_PORTAL_FILTERS: PortalFilters = {
    view: 'sent',
    search: '',
    sentStatus: 'all',
    templateStatus: 'all',
    sentSort: 'newest',
    templateSort: 'updated'
}

type Props = {
    filters: PortalFilters
    onChange: (patch: Partial<PortalFilters>) => void
    onSend: () => void
    onCreate: () => void
    /** Opens the analytics window across the sent surveys. */
    onAnalytics: () => void
}

export const SurveyToolbar: React.FC<Props> = ({ filters, onChange, onSend, onCreate, onAnalytics }) => {
    const isSent = filters.view === 'sent'

    return (
        <DashboardFilterBar>
            <div className='ws-toolbar'>
                <Input
                    className='ws-toolbar-search'
                    placeholder={isSent ? 'Search sent surveys' : 'Search templates'}
                    prefix={<SearchOutlined />}
                    value={filters.search}
                    onChange={e => onChange({ search: e.target.value })}
                    allowClear
                    aria-label={isSent ? 'Search sent surveys' : 'Search templates'}
                />

                {isSent ? (
                    <Segmented
                        className='ws-toolbar-status'
                        block
                        value={filters.sentStatus}
                        onChange={sentStatus => onChange({ sentStatus: sentStatus as PortalFilters['sentStatus'] })}
                        options={[
                            { label: 'All', value: 'all' },
                            { label: 'Open', value: 'pending' },
                            { label: 'Done', value: 'completed' },
                            { label: 'Closed', value: 'closed' }
                        ]}
                    />
                ) : (
                    <Segmented
                        className='ws-toolbar-status'
                        block
                        value={filters.templateStatus}
                        onChange={templateStatus =>
                            onChange({ templateStatus: templateStatus as PortalFilters['templateStatus'] })
                        }
                        options={[
                            { label: 'All', value: 'all' },
                            { label: 'Ready', value: 'published' },
                            { label: 'Draft', value: 'draft' },
                            { label: 'Archived', value: 'archived' }
                        ]}
                    />
                )}

                <Segmented
                    value={filters.view}
                    onChange={view => onChange({ view: view as PortalView })}
                    options={[
                        { label: 'Sent', value: 'sent', icon: <SendOutlined /> },
                        { label: 'Templates', value: 'templates', icon: <FileTextOutlined /> }
                    ]}
                    aria-label='Sent surveys or templates'
                />

                <Button className='ws-toolbar-button' icon={<BarChartOutlined />} onClick={onAnalytics}>
                    Analytics
                </Button>

                {isSent ? (
                    <Button className='ws-toolbar-button' type='primary' icon={<SendOutlined />} onClick={onSend}>
                        Send survey
                    </Button>
                ) : (
                    <Button className='ws-toolbar-button' type='primary' icon={<PlusOutlined />} onClick={onCreate}>
                        New survey
                    </Button>
                )}
            </div>
        </DashboardFilterBar>
    )
}
