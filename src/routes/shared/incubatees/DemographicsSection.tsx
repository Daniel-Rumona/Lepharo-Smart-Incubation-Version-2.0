import React from 'react'
import { Empty } from 'antd'
import { MailOutlined, PhoneOutlined, SendOutlined, ExportOutlined, EnvironmentOutlined } from '@ant-design/icons'
import { ContactList, ContactRow, OwnershipCards, contactActions } from '@/components/workspace'
import { SmeRow, formatDateTime, getDisplayLocation, isBlankValue } from './participantsData'
import { TimelineSteps } from './InfoBlocks'

/** Profile facts, contact details, ownership and timeline for the selected SME. */
export const DemographicsSection: React.FC<{ row: SmeRow | null }> = ({ row: selectedRow }) => {
    if (!selectedRow) return <Empty description='Select an SME' />

    const location = getDisplayLocation(selectedRow)
    const address = [selectedRow.businessAddress, location].filter(v => !isBlankValue(v)).join(', ')
    const { blackOwnedPercent, femaleOwnedPercent, youthOwnedPercent } = selectedRow.ownership
    const hasTimeline = !isBlankValue(formatDateTime(selectedRow.recruitedAt)) || !isBlankValue(formatDateTime(selectedRow.onboardedAt))
    const hasOwnership = [blackOwnedPercent, femaleOwnedPercent, youthOwnedPercent, selectedRow.beeLevel]
        .some(value => !isBlankValue(value))
    const fact = (label: string, value?: React.ReactNode) => (
        <div key={label}>
            <dt>{label}</dt>
            <dd>{isBlankValue(value) ? <span className='ws-muted'>—</span> : value}</dd>
        </div>
    )

    return (
        <div className='ws-detail-body'>
            <section>
                <h4 className='ws-section-title'>Profile</h4>
                <dl className='ws-facts'>
                    {fact('SME number', selectedRow.smmeNo)}
                    {fact('Registration number', selectedRow.registrationNumber)}
                    {fact('ID number', selectedRow.idNumber)}
                    {fact('Sector', selectedRow.sector)}
                    {fact('Group', selectedRow.group)}
                    {fact('Gender', selectedRow.gender)}
                    {fact('Hub', selectedRow.hub)}
                    {fact('Branch', selectedRow.branchName)}
                </dl>
            </section>

            <section>
                <h4 className='ws-section-title'>Contact</h4>
                <ContactList>
                    <ContactRow
                        icon={<MailOutlined />}
                        label='Email'
                        value={selectedRow.email}
                        empty='No email on file'
                        action={contactActions.email(selectedRow.email, <SendOutlined />)}
                        half
                    />
                    <ContactRow
                        icon={<PhoneOutlined />}
                        label='Phone'
                        value={selectedRow.phone}
                        empty='No phone number on file'
                        copyLabel='Phone number'
                        action={contactActions.phone(selectedRow.phone, <PhoneOutlined />)}
                        half
                    />
                    <ContactRow
                        icon={<EnvironmentOutlined />}
                        label='Address'
                        value={address}
                        empty='No address on file'
                        action={contactActions.map(address, <ExportOutlined />)}
                    />
                </ContactList>
            </section>

            {hasOwnership && (
                <section>
                    <h4 className='ws-section-title'>
                        Ownership
                        {!isBlankValue(selectedRow.beeLevel) && <span className='ptx-bee'>B-BBEE level {selectedRow.beeLevel}</span>}
                    </h4>
                    <OwnershipCards
                        items={[
                            { label: 'Black owned', value: blackOwnedPercent },
                            { label: 'Women owned', value: femaleOwnedPercent },
                            { label: 'Youth owned', value: youthOwnedPercent }
                        ]}
                    />
                </section>
            )}

            {hasTimeline && (
                <section>
                    <h4 className='ws-section-title'>Timeline</h4>
                    <TimelineSteps
                        steps={[
                            { label: 'Recruited', value: selectedRow.recruitedAt },
                            { label: 'Onboarded', value: selectedRow.onboardedAt }
                        ]}
                    />
                </section>
            )}
        </div>
    )
}
