import React from 'react'
import { Avatar, Tag, Tooltip } from 'antd'
import { ClockCircleOutlined, FlagOutlined, InboxOutlined } from '@ant-design/icons'
import { EntityAvatar } from '@/components/workspace'
import { PRIORITY_META, STATUS_META, dueState, type Person, type Task } from './taskTypes'

/** Small shared pieces of the Team Workroom: tags and assignee avatars. */

export const StatusTag: React.FC<{ task: Task }> = ({ task }) => (
    <Tag color={STATUS_META[task.status].color} bordered={false}>
        {STATUS_META[task.status].label}
    </Tag>
)

export const PriorityTag: React.FC<{ task: Task }> = ({ task }) => (
    <Tag color={PRIORITY_META[task.priority].color} icon={<FlagOutlined />} bordered={false}>
        {PRIORITY_META[task.priority].label}
    </Tag>
)

export const DueTag: React.FC<{ task: Task }> = ({ task }) => {
    const state = dueState(task)
    if (!state) return null
    return (
        <Tag color={state.color} icon={<ClockCircleOutlined />} bordered={false}>
            {state.text}
        </Tag>
    )
}

export const ArchivedTag: React.FC<{ task: Task }> = ({ task }) =>
    task.archived ? (
        <Tag icon={<InboxOutlined />} bordered={false}>
            Archived
        </Tag>
    ) : null

export const assigneesOf = (task: Task, people: Map<string, Person>): Person[] =>
    (task.assignees || [])
        .filter(a => a?.userId)
        .map(a => people.get(String(a.userId)) || { id: String(a.userId), name: 'Unknown coordinator' })

export const assigneeSummary = (task: Task, people: Map<string, Person>) => {
    const list = assigneesOf(task, people)
    if (!list.length) return 'Unassigned'
    return list.length > 2 ? `${list[0].name}, ${list[1].name} +${list.length - 2}` : list.map(p => p.name).join(', ')
}

/** Overlapping avatars for a task's assignees. */
export const AssigneeAvatars: React.FC<{ task: Task; people: Map<string, Person>; size?: number; max?: number }> = ({
    task,
    people,
    size = 24,
    max = 3
}) => {
    const list = assigneesOf(task, people)
    if (!list.length) return null
    return (
        <Avatar.Group max={{ count: max, style: { fontSize: 11 } }} size={size}>
            {list.map(p => (
                <Tooltip key={p.id} title={p.name}>
                    <span>
                        <EntityAvatar name={p.name} photo={p.photo} size={size} />
                    </span>
                </Tooltip>
            ))}
        </Avatar.Group>
    )
}
