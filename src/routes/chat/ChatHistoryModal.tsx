import React from 'react'
import { Empty, Modal, Spin } from 'antd'
import { CloseOutlined, MessageOutlined } from '@ant-design/icons'
import { useChatSession } from '@/routes/chat/ChatSessionContext'
import './chat-history-modal.css'

interface ChatHistoryModalProps {
    open: boolean
    onClose: () => void
}

export const ChatHistoryModal: React.FC<ChatHistoryModalProps> = ({ open, onClose }) => {
    const { todaysSessions, activeSessionId, historyLoading, switchToSession } = useChatSession()

    const handleSelect = async (sessionId: string) => {
        await switchToSession(sessionId)
        onClose()
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            closable={false}
            centered
            width={440}
            destroyOnClose
            styles={{
                content: { padding: 0, borderRadius: 20, overflow: 'hidden' },
                body: { padding: 0 }
            }}
        >
            <div className='chat-history-header'>
                <span className='chat-history-title'>Today&rsquo;s conversations</span>
                <button type='button' className='chat-history-close' aria-label='Close' onClick={onClose}>
                    <CloseOutlined />
                </button>
            </div>
            <div className='chat-history-list'>
                {historyLoading ? (
                    <div className='chat-history-loading'><Spin /></div>
                ) : todaysSessions.length === 0 ? (
                    <Empty
                        description='No conversations yet today'
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        style={{ padding: '32px 16px' }}
                    />
                ) : (
                    todaysSessions.map(session => (
                        <button
                            type='button'
                            key={session.id}
                            className={`chat-history-item ${session.id === activeSessionId ? 'chat-history-item-active' : ''}`}
                            onClick={() => void handleSelect(session.id)}
                        >
                            <MessageOutlined className='chat-history-item-icon' />
                            <span className='chat-history-item-body'>
                                <span className='chat-history-item-title'>{session.title}</span>
                                <span className='chat-history-item-meta'>
                                    {session.updatedAtLabel}
                                    {session.messageCount > 0 && ` · ${session.messageCount} messages`}
                                </span>
                            </span>
                        </button>
                    ))
                )}
            </div>
        </Modal>
    )
}

export default ChatHistoryModal
