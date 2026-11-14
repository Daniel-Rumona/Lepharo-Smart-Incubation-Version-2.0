import { useCallback, useState } from 'react'
import { message } from 'antd'
import {
    confirmSmeGroupMovement,
    evaluateGroupEligibility,
    notifyMeGroupMovementBatch,
    requestSmeGroupMovement,
    returnSmeGroupMovement,
    sendGroupDetailsReminder,
    type GroupEligibility,
    type GroupProgressionRules,
    type GroupRequirement,
    type IncubationGroup
} from '@/services/groupLifecycleService'
import { outstandingReminderItems, withFreshEvidence, type SmeGroupRow } from './groupData'

type Options = {
    user: any
    departmentId: string
    departmentName: string
    /** The requirements and rules of the row's own programme. */
    configFor: (row: SmeGroupRow) => { requirements: GroupRequirement[]; rules: GroupProgressionRules }
    eligibilityFor: (row: SmeGroupRow) => GroupEligibility
}

/**
 * The ROM and M&E actions on the Groups page, one SME or a batch at a time.
 * `busyKey` names the action in flight ("promote:<key>", "bulk:submit", …)
 * so only its button spins and the rest are disabled.
 */
export const useGroupActions = ({ user, departmentId, departmentName, configFor, eligibilityFor }: Options) => {
    const [busyKey, setBusyKey] = useState<string | null>(null)

    const sendReminder = useCallback(async (row: SmeGroupRow) => {
        const eligibility = eligibilityFor(row)
        if (!eligibility.target) return
        if (!row.email) {
            message.error('Add an email address to the SME application before sending a reminder.')
            return
        }
        setBusyKey(`reminder:${row.key}`)
        try {
            await sendGroupDetailsReminder({
                applicationId: row.applicationId,
                participantId: row.participantId,
                email: row.email,
                name: row.name,
                programName: row.programName,
                current: row.group,
                target: eligibility.target,
                missing: outstandingReminderItems(eligibility),
                sentBy: user?.email || (user as any)?.name
            })
            message.success(`Details reminder emailed to ${row.name}.`)
        } catch (error: any) {
            message.error(error?.message || 'The reminder email could not be sent.')
        } finally {
            setBusyKey(null)
        }
    }, [eligibilityFor, user])

    const requestMovement = useCallback(async (row: SmeGroupRow) => {
        const eligibility = eligibilityFor(row)
        if (!eligibility.eligible || !eligibility.target) return
        setBusyKey(`promote:${row.key}`)
        try {
            const result = await requestSmeGroupMovement({
                applicationId: row.applicationId,
                participantId: row.participantId,
                current: row.group,
                target: eligibility.target,
                actor: {
                    id: (user as any)?.uid || (user as any)?.id,
                    name: (user as any)?.name || user?.displayName || user?.email || 'Operations',
                    email: user?.email,
                    departmentId,
                    departmentName
                },
                reason: eligibility.summary,
                requirementsMet: eligibility.met,
                smeName: row.name,
                programName: row.programName
            })
            if (result.notificationError || !result.notificationSent) {
                message.warning(`Movement submitted, but the M&E notification email was not delivered. M&E can still see it in the pending queue.`)
            } else {
                message.success(`${row.name}'s movement was submitted and emailed to M&E.`)
            }
        } catch (error: any) {
            message.error(error?.message || 'The group movement request could not be submitted.')
        } finally {
            setBusyKey(null)
        }
    }, [departmentId, departmentName, eligibilityFor, user])

    const confirmMovement = useCallback(async (row: SmeGroupRow) => {
        if (!row.pendingMovement) return
        setBusyKey(`confirm:${row.key}`)
        try {
            const fresh = await withFreshEvidence(row)
            if (!eligibilityFor(fresh).eligible) {
                message.error('This SME no longer meets the progression requirements. Return the request to ROM for review.')
                return
            }
            const nextEligibility = evaluateGroupEligibility({
                current: row.pendingMovement.to,
                ...configFor(row),
                evidence: fresh.evidence,
                interventions: row.interventions,
                graduationApproved: false
            })
            const result = await confirmSmeGroupMovement({
                applicationId: row.applicationId,
                participantId: row.participantId,
                request: row.pendingMovement,
                actor: {
                    id: (user as any)?.uid || (user as any)?.id,
                    name: (user as any)?.name || user?.email || 'M&E',
                    email: user?.email,
                    departmentId,
                    departmentName
                },
                smeName: row.name,
                smeEmail: row.email,
                programName: row.programName,
                nextRequirements: nextEligibility.missing
            })
            if (!row.email) {
                message.warning(`Movement confirmed, but ${row.name} has no email address for the congratulations message.`)
            } else if (result.notificationError || !result.notificationSent) {
                message.warning('Movement confirmed, but the SME congratulations email was not delivered.')
            } else {
                message.success(`Movement confirmed and ${row.name} was emailed the next-stage requirements.`)
            }
        } catch (error: any) {
            message.error(error?.message || 'The movement could not be confirmed.')
        } finally {
            setBusyKey(null)
        }
    }, [configFor, departmentId, departmentName, eligibilityFor, user])

    const returnMovement = useCallback(async (row: SmeGroupRow) => {
        if (!row.pendingMovement) return
        setBusyKey(`return:${row.key}`)
        try {
            await returnSmeGroupMovement({
                applicationId: row.applicationId,
                request: row.pendingMovement,
                actor: {
                    id: (user as any)?.uid || (user as any)?.id,
                    name: (user as any)?.name || user?.email || 'M&E',
                    email: user?.email,
                    departmentId,
                    departmentName
                }
            })
            message.success(`The movement request for ${row.name} was returned to ROM.`)
        } catch (error: any) {
            message.error(error?.message || 'The movement request could not be returned.')
        } finally {
            setBusyKey(null)
        }
    }, [departmentId, departmentName, user])

    /** Emails every SME in `rows` that still owes details, skipping anyone reminded in the last day. */
    const remindAll = async (rows: SmeGroupRow[]) => {
        const targets = rows.filter(row => {
            const eligibility = eligibilityFor(row)
            const reminderIsRecent = !!row.lastReminderAt &&
                Date.now() - row.lastReminderAt.getTime() < 24 * 60 * 60 * 1000
            return !!row.email && !!eligibility.target && !eligibility.eligible &&
                eligibility.missing.length > 0 && !reminderIsRecent
        })
        if (!targets.length) {
            message.info('No SMEs in this view need a details reminder.')
            return
        }
        setBusyKey('reminder:all')
        let sent = 0
        for (const row of targets) {
            try {
                const eligibility = eligibilityFor(row)
                await sendGroupDetailsReminder({
                    applicationId: row.applicationId,
                    participantId: row.participantId,
                    email: row.email!,
                    name: row.name,
                    programName: row.programName,
                    current: row.group,
                    target: eligibility.target!,
                    missing: outstandingReminderItems(eligibility),
                    sentBy: user?.email || (user as any)?.name
                })
                sent += 1
            } catch (error) {
                console.error(`Failed group reminder for ${row.name}`, error)
            }
        }
        setBusyKey(null)
        sent === targets.length
            ? message.success(`${sent} reminder email${sent === 1 ? '' : 's'} sent.`)
            : message.warning(`${sent} of ${targets.length} reminder emails sent.`)
    }

    /** Submits the eligible SMEs in `rows` to M&E, with one summary email. */
    const submitToME = async (rows: SmeGroupRow[]) => {
        const targets = rows.filter(row =>
            !row.pendingMovement &&
            eligibilityFor(row).eligible &&
            !!eligibilityFor(row).target
        )
        if (!targets.length) {
            message.info('Select at least one eligible SME.')
            return
        }
        setBusyKey('bulk:submit')
        const batchId = `group-movement-${Date.now()}`
        const submitted: Array<{
            applicationId: string
            requestId: string
            smeName: string
            current: IncubationGroup
            target: IncubationGroup
        }> = []
        const failed: string[] = []
        for (const row of targets) {
            try {
                const eligibility = eligibilityFor(row)
                const result = await requestSmeGroupMovement({
                    applicationId: row.applicationId,
                    participantId: row.participantId,
                    current: row.group,
                    target: eligibility.target!,
                    actor: {
                        id: (user as any)?.uid || (user as any)?.id,
                        name: (user as any)?.name || user?.displayName || user?.email || 'Operations',
                        email: user?.email,
                        departmentId,
                        departmentName
                    },
                    reason: eligibility.summary,
                    requirementsMet: eligibility.met,
                    smeName: row.name,
                    programName: row.programName,
                    batchId,
                    suppressNotification: true
                })
                submitted.push({
                    applicationId: row.applicationId,
                    requestId: result.request.id,
                    smeName: row.name,
                    current: row.group,
                    target: eligibility.target!
                })
            } catch (error: any) {
                failed.push(`${row.name}: ${error?.message || 'submission failed'}`)
            }
        }
        let emailFailed = false
        if (submitted.length) {
            try {
                await notifyMeGroupMovementBatch({
                    batchId,
                    programName: targets[0]?.programName,
                    submittedBy: (user as any)?.name || user?.email || 'ROM',
                    movements: submitted
                })
            } catch (error) {
                console.error('Bulk M&E notification failed', error)
                emailFailed = true
            }
        }
        setBusyKey(null)
        if (failed.length) {
            message.warning(`${submitted.length} submitted; ${failed.length} failed. ${failed.join(' | ')}`)
        } else if (emailFailed) {
            message.warning(`${submitted.length} submitted, but the M&E summary email was not delivered. The requests remain visible here.`)
        } else {
            message.success(`${submitted.length} movement request${submitted.length === 1 ? '' : 's'} submitted to M&E.`)
        }
    }

    /** Confirms the pending movements in `rows`, re-checking each SME's evidence first. */
    const confirmMany = async (rows: SmeGroupRow[]) => {
        const targets = rows.filter(row => !!row.pendingMovement)
        if (!targets.length) {
            message.info('Select at least one pending movement.')
            return
        }
        setBusyKey('bulk:confirm')
        let confirmed = 0
        const failed: string[] = []
        for (const row of targets) {
            try {
                const fresh = await withFreshEvidence(row)
                const eligibility = eligibilityFor(fresh)
                if (!eligibility.eligible) {
                    throw new Error('progression requirements are no longer met')
                }
                const nextEligibility = evaluateGroupEligibility({
                    current: row.pendingMovement!.to,
                    ...configFor(row),
                    evidence: fresh.evidence,
                    interventions: row.interventions,
                    graduationApproved: false
                })
                await confirmSmeGroupMovement({
                    applicationId: row.applicationId,
                    participantId: row.participantId,
                    request: row.pendingMovement!,
                    actor: {
                        id: (user as any)?.uid || (user as any)?.id,
                        name: (user as any)?.name || user?.email || 'M&E',
                        email: user?.email,
                        departmentId,
                        departmentName
                    },
                    smeName: row.name,
                    smeEmail: row.email,
                    programName: row.programName,
                    nextRequirements: nextEligibility.missing
                })
                confirmed += 1
            } catch (error: any) {
                failed.push(`${row.name}: ${error?.message || 'confirmation failed'}`)
            }
        }
        setBusyKey(null)
        failed.length
            ? message.warning(`${confirmed} confirmed; ${failed.length} failed. ${failed.join(' | ')}`)
            : message.success(`${confirmed} movement${confirmed === 1 ? '' : 's'} confirmed.`)
    }

    return { busyKey, sendReminder, requestMovement, confirmMovement, returnMovement, remindAll, submitToME, confirmMany }
}
