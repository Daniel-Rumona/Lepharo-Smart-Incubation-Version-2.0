/**
 * Monthly Executive & Operations Report for one centre, as a PowerPoint deck
 * on the same template as the centre's existing report (Lepharo swoosh,
 * partner logos, numbered red circle). The backgrounds in
 * public/templates/centre-report are the original slides with their text
 * blanked out; everything variable is drawn on top.
 *
 * Budget/expenditure and printer usage are deliberately left out.
 * Infrastructure fund submissions are not in the system yet.
 */
import PptxGenJS from 'pptxgenjs'
import dayjs, { Dayjs } from 'dayjs'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { formatRole } from '@/lib/roleLabels'
import { BranchOperatingHours, defaultOperatingHours, getDayHours } from '@/utils/branchOperatingHours'
import { computeDayInfo, type DayStatus } from '@/routes/shared/timesheet/attendanceShared'
import type { LeaveRequestEntry, TimesheetEntry } from '@/routes/shared/timesheet/timesheetUtils'
import { resolveInquiryChannel } from '@/utils/inquirySource'
import { effectiveLeaseStatus, leaseDuration, sortWorkshops, WORKSHOPS, type FacilityWorkshop } from './workshops'

const MAROON = '7B1416'
const CIRCLE = '791315'
const BLUE = '4472C4'
const BLUE_LIGHT = 'DAE3F3'
const TEXT = '262626'
const FONT = 'Calibri'

const RISK_FILL: Record<string, string> = { High: 'FF0000', Medium: 'FFC000', Low: '92D050' }
const ATTENDANCE_FILL: Partial<Record<DayStatus, string>> = {
    onsite: '1677FF',
    remote: '13C2C2',
    leave: 'FAAD14',
    absent: 'FF4D4F',
    closed: 'EDEDED',
    upcoming: 'FFFFFF'
}

// Content area on the template, in inches (13.333 x 7.5 slide).
const AREA = { x: 0.6, y: 1.4, w: 12.1, h: 5.05 }

type Person = {
    id: string
    name: string
    role: string
    title: string
    photoURL?: string
    status: 'Active' | 'Active (Intern)' | 'On hold' | 'Inactive'
}

type ImageRef = { url: string }

export type CentreReportData = {
    branchName: string
    month: Dayjs
    presenter: Person
    presenterEmail: string
    team: Person[]
    issues: Array<{ area: string; title: string; risk: string; actionType: string; escalatedTo?: string; action?: string; status: string; images: ImageRef[] }>
    gaps: Array<{ gap: string; quantity?: number | null; correctiveAction: string; status: string }>
    needs: Array<{ need: string; product: string; quantity: number; price: number | null }>
    workshops: Array<Omit<FacilityWorkshop, 'id'>>
    smmeTotal: number
    smmeGroups: Array<[string, number]>
    localities: Array<[string, number]>
    inquiryTotal: number
    inquiryChannels: Array<[string, number]>
    attendance: Array<{ person: Person; days: Array<{ date: Dayjs; status: DayStatus }> }>
    challenges: Array<{ challenge: string; solution: string; action: string }>
}

// ---- loading ---------------------------------------------------------------

const clean = (value: unknown) => String(value ?? '').trim()
const toDate = (value: any): Dayjs | null => {
    if (!value) return null
    const d = value?.toDate ? dayjs(value.toDate()) : dayjs(value)
    return d.isValid() ? d : null
}

const personOf = (user: any): Person => {
    const workerType = clean(user.workerType || user.employmentType).toLowerCase()
    const status = clean(user.status).toLowerCase()
    return {
        id: user.id,
        name: clean(user.name || user.fullName || user.email) || 'Unnamed',
        role: clean(user.role).toLowerCase(),
        title: clean(user.jobTitle || user.position) || formatRole(user.role) || 'Staff member',
        photoURL: user.photoURL || undefined,
        status: ['inactive', 'terminated', 'resigned', 'disabled'].includes(status)
            ? 'Inactive'
            : ['on hold', 'on_hold', 'suspended', 'onhold'].includes(status)
                ? 'On hold'
                : workerType.includes('intern')
                    ? 'Active (Intern)'
                    : 'Active'
    }
}

const countBy = (values: string[], limit: number): Array<[string, number]> => {
    const counts = new Map<string, number>()
    values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1))
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit)
}

const chunk = <T,>(list: T[], size: number) =>
    Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size))

const STAFF_ROLES = ['projectadmin', 'coordinator', 'receptionist', 'employee']

export const loadCentreReportData = async (me: any, month: Dayjs): Promise<CentreReportData> => {
    const branchId = clean(me?.assignedBranch)
    if (!branchId) throw new Error('Your profile has no assigned centre.')

    const monthStart = month.startOf('month')
    const monthEnd = month.endOf('month')
    const startKey = monthStart.format('YYYY-MM-DD')
    const endKey = monthEnd.format('YYYY-MM-DD')

    const byBranch = (name: string) => getDocs(query(collection(db, name), where('branchId', '==', branchId)))
    const rows = (snap: any) => snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))

    const [branchSnap, usersSnap, issuesSnap, gapsSnap, needsSnap, workshopsSnap, inquiriesSnap, appsSnap, challengesSnap] = await Promise.all([
        getDoc(doc(db, 'branches', branchId)),
        getDocs(query(collection(db, 'users'), where('assignedBranch', '==', branchId))),
        byBranch('facilityIssues'),
        byBranch('facilityGaps'),
        byBranch('facilityNeeds'),
        byBranch(WORKSHOPS),
        byBranch('inquiries'),
        getDocs(query(collection(db, 'applications'), where('applicationStatus', 'in', ['Accepted', 'accepted']))),
        getDocs(collection(db, 'operationalChallenges')).catch(() => null)
    ])

    const branch = branchSnap.data() || {}
    const branchName = clean(branch.name || branch.branchName) || 'Centre'
    const hours: BranchOperatingHours = branch.operatingHours || defaultOperatingHours()

    const presenter = personOf({ ...me, id: me.id || me.uid })
    const team = (rows(usersSnap) as any[])
        .filter(user => user.id !== presenter.id && STAFF_ROLES.includes(clean(user.role).toLowerCase()))
        .map(personOf)
        .sort((a, b) => a.name.localeCompare(b.name))
    const staff = [presenter, ...team]

    // Accepted SMMEs of this centre.
    const apps = (rows(appsSnap) as any[]).filter(app =>
        [app.branchId, app.assignedBranch, app.branch?.id].includes(branchId) ||
        (!!app.branchName && clean(app.branchName).toLowerCase() === branchName.toLowerCase())
    )

    const inquiries = (rows(inquiriesSnap) as any[]).filter(item => {
        const at = toDate(item.submittedAt || item.createdAt)
        return at && !at.isBefore(monthStart) && !at.isAfter(monthEnd)
    })

    // Attendance: the month's timesheets for every staff member, ids in batches of 30.
    const ids = staff.map(person => person.id)
    const timesheetSnaps = await Promise.all(
        chunk(ids, 30).map(batch =>
            getDocs(query(
                collection(db, 'timesheets'),
                where('userId', 'in', batch),
                where('date', '>=', startKey),
                where('date', '<=', endKey)
            ))
        )
    )
    const timesheets = timesheetSnaps.flatMap(rows) as TimesheetEntry[]
    const leaveRequests = await getDocs(query(collection(db, 'leaveRequests'), where('status', '==', 'approved')))
        .then(snap => rows(snap) as LeaveRequestEntry[])
        .catch(() => [] as LeaveRequestEntry[])

    const todayKey = dayjs().format('YYYY-MM-DD')
    const now = new Date()
    const workingDays: Dayjs[] = []
    for (let d = monthStart; !d.isAfter(monthEnd, 'day'); d = d.add(1, 'day')) {
        if (!getDayHours(hours, d.toDate()).closed) workingDays.push(d)
    }
    const attendance = staff.map(person => {
        const ctx = {
            startDate: startKey,
            endDate: endKey,
            entries: timesheets.filter(entry => entry.userId === person.id),
            leaveRequests: leaveRequests.filter(leave => leave.employeeId === person.id),
            shiftHours: hours,
            todayKey,
            now
        }
        return { person, days: workingDays.map(date => ({ date, status: computeDayInfo(date, ctx).status })) }
    })

    const challenges = challengesSnap
        ? (rows(challengesSnap) as any[])
            .filter(row => ids.includes(row.createdById) && !['Closed', 'Resolved'].includes(row.status))
            .map(row => ({
                challenge: [clean(row.title), clean(row.details)].filter(Boolean).join(': '),
                solution: (row.mitigationSteps || []).join('; ') || '—',
                action: [clean(row.status) || 'Open', row.dueDate ? `due ${toDate(row.dueDate)?.format('D MMM YYYY')}` : ''].filter(Boolean).join(', ')
            }))
        : []

    return {
        branchName,
        month,
        presenter,
        presenterEmail: clean(me.email),
        team,
        issues: (rows(issuesSnap) as any[])
            .filter(issue => issue.status !== 'Resolved')
            .sort((a, b) => ['High', 'Medium', 'Low'].indexOf(a.risk) - ['High', 'Medium', 'Low'].indexOf(b.risk))
            .map(issue => ({ ...issue, images: issue.images || [] })),
        gaps: (rows(gapsSnap) as any[]).filter(gap => gap.status !== 'Closed'),
        needs: (rows(needsSnap) as any[]).sort((a, b) => clean(a.need).localeCompare(clean(b.need))),
        workshops: sortWorkshops(rows(workshopsSnap) as FacilityWorkshop[]),
        smmeTotal: apps.length,
        smmeGroups: countBy(apps.map(app => clean(app.group || app.gapGroup || app.sector)), 5),
        localities: countBy(apps.map(app => clean(app.town || app.location || app.hub)), 10),
        inquiryTotal: inquiries.length,
        inquiryChannels: countBy(inquiries.map(item => resolveInquiryChannel(item.source)), 5),
        attendance,
        challenges
    }
}

// ---- images ----------------------------------------------------------------

const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
    })

/** Centre-cropped to the box's aspect ratio and downsized; null if it can't be read. */
const croppedImage = async (src: string | undefined, w: number, h: number, maxPx = 900) => {
    if (!src) return null
    try {
        const img = await loadImage(src)
        const target = w / h
        const sourceRatio = img.naturalWidth / img.naturalHeight
        const sw = sourceRatio > target ? img.naturalHeight * target : img.naturalWidth
        const sh = sourceRatio > target ? img.naturalHeight : img.naturalWidth / target
        const scale = Math.min(1, maxPx / Math.max(sw, sh))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(sw * scale)
        canvas.height = Math.round(sh * scale)
        canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height)
        return canvas.toDataURL('image/jpeg', 0.85)
    } catch {
        return null
    }
}

const initials = (name: string) =>
    name.split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || '?'

const rand = (value: number) => `R ${value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ---- deck ------------------------------------------------------------------

export const generateCentreReport = async (data: CentreReportData) => {
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_WIDE'
    pptx.title = `${data.branchName} Monthly Executive & Operations Report`
    pptx.company = 'Lepharo Incubation Programme NPC'
    pptx.author = data.presenter.name

    const template = (name: string) => `${window.location.origin}/templates/centre-report/${name}.jpg`
    let pageNo = 0

    const contentSlide = (title: string) => {
        pageNo += 1
        const slide = pptx.addSlide()
        slide.background = { path: template('content') }
        slide.addShape(pptx.ShapeType.ellipse, { x: 12.65, y: 0.8, w: 0.36, h: 0.36, fill: { color: CIRCLE }, line: { color: CIRCLE } })
        slide.addText(String(pageNo), { x: 12.65, y: 0.8, w: 0.36, h: 0.36, align: 'center', valign: 'middle', fontFace: FONT, fontSize: 11, color: 'FFFFFF', margin: 0 })
        slide.addText(data.branchName, { x: 6.62, y: 6.9, w: 1.9, h: 0.22, fontFace: FONT, fontSize: 8, bold: true, color: MAROON, margin: 0 })
        if (title) {
            slide.addText(title, { x: 1.6, y: 0.62, w: 10.2, h: 0.5, align: 'center', valign: 'middle', fontFace: FONT, fontSize: 24, bold: true, color: MAROON })
        }
        return slide
    }

    const emptyNote = (slide: PptxGenJS.Slide, text: string) =>
        slide.addText(text, { x: AREA.x, y: 3.4, w: AREA.w, h: 0.5, align: 'center', fontFace: FONT, fontSize: 16, italic: true, color: '7F7F7F' })

    function headerCell(text: string, fill = BLUE) {
        return { text, options: { bold: true, color: 'FFFFFF', fill: { color: fill } } }
    }

    // 1. Cover
    {
        pageNo += 1
        const slide = pptx.addSlide()
        slide.background = { path: template('cover') }
        slide.addText(
            [
                { text: `${data.branchName}`, options: { fontSize: 22, bold: true, color: MAROON, breakLine: true } },
                { text: 'Monthly Executive & Operations Report', options: { fontSize: 15, bold: true, color: MAROON } }
            ],
            { x: 0.62, y: 2.45, w: 6.2, h: 0.9, fontFace: FONT, valign: 'top', margin: 0 }
        )
        slide.addText(dayjs().format('D MMMM YYYY'), { x: 0.66, y: 3.6, w: 3, h: 0.35, fontFace: FONT, fontSize: 14, bold: true, color: MAROON, margin: 0 })
        slide.addText(
            [
                { text: 'Presented by:', options: { breakLine: true } },
                { text: data.presenter.name, options: { breakLine: true } },
                { text: data.presenter.title, options: { breakLine: true } },
                { text: data.branchName, options: { breakLine: true } },
                { text: 'Lepharo Incubation Programme NPC' }
            ],
            { x: 0.62, y: 4.25, w: 3.6, h: 1.25, fontFace: FONT, fontSize: 10, bold: true, color: MAROON, valign: 'top', margin: 0, paraSpaceAfter: 2 }
        )
        const photo = await croppedImage(data.presenter.photoURL, 1, 1, 500)
        if (photo) slide.addImage({ data: photo, x: 3.0, y: 2.95, w: 1.2, h: 1.2 })
        slide.addText(`Report period: ${data.month.format('MMMM YYYY')}`, { x: 0.62, y: 5.5, w: 4, h: 0.25, fontFace: FONT, fontSize: 9, color: '595959', margin: 0 })
    }

    // 2. Agenda
    const agenda: Array<[string, string[]?]> = [
        ['Meet the team'],
        ['Centre reporting section', ['Centre management', 'Facilities management', 'Facilities gaps']],
        ['Update on existing SMMEs'],
        ['SMME locality'],
        ['Workshop occupancy'],
        ['Staff attendance'],
        ['Needs assessment list'],
        ['Challenges']
    ]
    {
        const slide = contentSlide('AGENDA')
        const lines: PptxGenJS.TextProps[] = []
        agenda.forEach(([item, children], index) => {
            lines.push({ text: `${index + 1}. ${item.toUpperCase()}`, options: { breakLine: true } })
            children?.forEach((child, i) => lines.push({ text: `${i + 1}. ${child.toUpperCase()}`, options: { indentLevel: 1, breakLine: true } }))
        })
        slide.addText(lines, { x: 1.2, y: 1.6, w: 9, h: 4.6, fontFace: FONT, fontSize: 16, color: TEXT, valign: 'top', paraSpaceAfter: 6 })
    }

    // 3. Meet the team: the presenter, then everyone else in columns.
    {
        const slide = contentSlide('MEET THE TEAM')
        const people = [data.presenter, ...data.team]
        const photos = await Promise.all(people.map(person => croppedImage(person.photoURL, 1, 1, 300)))
        const card = (person: Person, photo: string | null, x: number, y: number, w: number) => {
            const size = 0.5
            if (photo) {
                slide.addImage({ data: photo, x, y, w: size, h: size, rounding: true })
            } else {
                slide.addShape(pptx.ShapeType.ellipse, { x, y, w: size, h: size, fill: { color: MAROON }, line: { color: MAROON } })
                slide.addText(initials(person.name), { x, y, w: size, h: size, align: 'center', valign: 'middle', fontFace: FONT, fontSize: 11, bold: true, color: 'FFFFFF', margin: 0 })
            }
            slide.addText(
                [
                    { text: person.name, options: { bold: true, fontSize: 10, color: TEXT, breakLine: true } },
                    { text: person.title.toUpperCase(), options: { fontSize: 7.5, bold: true, color: MAROON } }
                ],
                { x: x + size + 0.08, y: y - 0.02, w: w - size - 0.1, h: size + 0.04, fontFace: FONT, valign: 'middle', margin: 0 }
            )
        }

        card(data.presenter, photos[0], 0.7, 3.65, 2.4)
        const others = data.team
        if (!others.length) {
            emptyNote(slide, 'No other staff are assigned to this centre.')
        } else {
            const perColumn = Math.min(7, Math.max(4, Math.ceil(others.length / 4)))
            const columns = chunk(others, perColumn).slice(0, 4)
            const colW = (AREA.x + AREA.w - 3.4) / columns.length
            const rowH = 0.68
            slide.addShape(pptx.ShapeType.line, { x: 2.9, y: 3.9, w: 0.35, h: 0, line: { color: 'A6A6A6', width: 1 } })
            columns.forEach((column, c) => {
                const x = 3.4 + c * colW
                const top = 3.9 - ((column.length - 1) * rowH) / 2
                slide.addShape(pptx.ShapeType.line, { x: x - 0.15, y: top + 0.25, w: 0, h: Math.max(0.01, (column.length - 1) * rowH), line: { color: 'A6A6A6', width: 1 } })
                if (c > 0) slide.addShape(pptx.ShapeType.line, { x: 3.25, y: 3.9, w: x - 3.4, h: 0, line: { color: 'D9D9D9', width: 0.75 } })
                column.forEach((person, r) => {
                    const y = top + r * rowH
                    slide.addShape(pptx.ShapeType.line, { x: x - 0.15, y: y + 0.25, w: 0.15, h: 0, line: { color: 'A6A6A6', width: 1 } })
                    card(person, photos[1 + others.indexOf(person)], x, y, colW - 0.1)
                })
            })
            if (others.length > perColumn * 4) {
                slide.addText(`+${others.length - perColumn * 4} more`, { x: 11, y: 6.2, w: 1.6, h: 0.3, fontFace: FONT, fontSize: 10, italic: true, color: '7F7F7F', align: 'right' })
            }
        }
    }

    // 4. Section divider
    {
        const slide = contentSlide('')
        slide.addText('CENTRE REPORTING SECTION', { x: 1.5, y: 3.4, w: 10.4, h: 0.9, fontFace: FONT, fontSize: 36, bold: true, color: MAROON, align: 'center' })
    }

    // 5. Centre management / operation
    {
        const slide = contentSlide('CENTRE MANAGEMENT/OPERATION')
        const statusFill: Record<Person['status'], string> = {
            Active: '00B050',
            'Active (Intern)': 'A9D08E',
            'On hold': 'FFC000',
            Inactive: 'FF0000'
        }
        const people = [data.presenter, ...data.team]
        const perRow = 6
        const tableRows: PptxGenJS.TableRow[] = [
            [{ text: 'CENTRE MANAGEMENT/OPERATION', options: { colspan: perRow, bold: true, color: 'FFFFFF', fill: { color: '375623' }, align: 'center' } }]
        ]
        chunk(people, perRow).forEach(row => {
            tableRows.push([
                ...row.map(person => ({
                    text: [
                        { text: person.title, options: { bold: true, breakLine: true } },
                        { text: person.name, options: { fontSize: 9 } }
                    ],
                    options: { fill: { color: statusFill[person.status] }, color: person.status === 'Inactive' ? 'FFFFFF' : TEXT }
                })),
                ...Array.from({ length: perRow - row.length }, () => ({ text: '', options: {} }))
            ])
        })
        slide.addTable(tableRows, { x: AREA.x, y: 1.5, w: AREA.w, colW: Array(perRow).fill(AREA.w / perRow), fontFace: FONT, fontSize: 11, border: { type: 'solid', color: 'FFFFFF', pt: 1 }, valign: 'middle', rowH: 0.6 })
        const legendY = Math.min(5.7, 1.5 + 0.6 * tableRows.length + 0.35)
        ;(Object.keys(statusFill) as Person['status'][]).forEach((status, i) => {
            slide.addShape(pptx.ShapeType.rect, { x: AREA.x, y: legendY + i * 0.24, w: 0.35, h: 0.18, fill: { color: statusFill[status] }, line: { color: statusFill[status] } })
            slide.addText(status === 'Inactive' ? 'Inactive/vacant' : status, { x: AREA.x + 0.45, y: legendY + i * 0.24 - 0.03, w: 2, h: 0.24, fontFace: FONT, fontSize: 9, color: TEXT, margin: 0 })
        })
    }

    // 6. Facilities management: six issues per slide, photo between header and risk.
    {
        const pages = chunk(data.issues, 6)
        if (!pages.length) emptyNote(contentSlide('FACILITIES MANAGEMENT'), 'No open facility issues.')
        for (const page of pages) {
            const slide = contentSlide('FACILITIES MANAGEMENT')
            const colW = 2.0
            const gap = 0.02
            const startX = AREA.x + (AREA.w - page.length * (colW + gap)) / 2
            for (const [i, issue] of page.entries()) {
                const x = startX + i * (colW + gap)
                slide.addText(
                    [
                        { text: issue.area, options: { fontSize: 9, breakLine: true } },
                        { text: issue.title, options: { fontSize: 12 } }
                    ],
                    { shape: pptx.ShapeType.rect, x, y: 1.4, w: colW, h: 0.8, fill: { color: BLUE }, fontFace: FONT, bold: true, color: 'FFFFFF', valign: 'top', margin: 4 }
                )
                const photo = await croppedImage(issue.images[0]?.url, colW, 2.25)
                if (photo) {
                    slide.addImage({ data: photo, x, y: 2.2, w: colW, h: 2.25 })
                } else {
                    slide.addText('No photo', { shape: pptx.ShapeType.rect, x, y: 2.2, w: colW, h: 2.25, fill: { color: 'F2F2F2' }, align: 'center', fontFace: FONT, fontSize: 10, italic: true, color: 'A6A6A6' })
                }
                const handling = issue.actionType === 'Escalated'
                    ? `Escalated${issue.escalatedTo ? ` to ${issue.escalatedTo}` : ''}`
                    : 'Maintenance issue'
                slide.addText(
                    [
                        { text: `${issue.risk} Risk`, options: { bold: true, breakLine: true } },
                        { text: `(${handling}${issue.action ? ` - ${issue.action}` : ''})`, options: { fontSize: 10 } }
                    ],
                    { shape: pptx.ShapeType.rect, x, y: 4.45, w: colW, h: 1.55, fill: { color: RISK_FILL[issue.risk] || 'FFC000' }, fontFace: FONT, fontSize: 12, color: TEXT, valign: 'top', margin: 4 }
                )
            }
        }
    }

    // 7. Facilities gaps: two tables side by side.
    {
        const perSide = 10
        const pages = chunk(data.gaps, perSide * 2)
        if (!pages.length) emptyNote(contentSlide('FACILITIES GAPS'), 'No open facilities gaps.')
        pages.forEach(page => {
            const slide = contentSlide('FACILITIES GAPS')
            chunk(page, perSide).forEach((side, s) => {
                const tableRows: PptxGenJS.TableRow[] = [[headerCell('GAPS'), headerCell('CORRECTIVE ACTION')]]
                side.forEach((gap, i) => {
                    const fill = { color: i % 2 ? 'FFFFFF' : BLUE_LIGHT }
                    tableRows.push([
                        { text: `${gap.quantity ? `${gap.quantity} ` : ''}${gap.gap}`, options: { fill } },
                        { text: gap.correctiveAction, options: { fill } }
                    ])
                })
                slide.addTable(tableRows, { x: AREA.x + 0.2 + s * 6.05, y: 1.5, w: 5.7, colW: [3.2, 2.5], fontFace: FONT, fontSize: 11, color: TEXT, border: { type: 'solid', color: 'FFFFFF', pt: 1 }, valign: 'middle' })
            })
        })
    }

    // 8. Update on existing SMMEs
    {
        const slide = contentSlide('UPDATE ON EXISTING SMMES')
        const tiles = (cells: Array<[string, number]>, y: number) => {
            if (!cells.length) return
            const w = Math.min(1.9, AREA.w / cells.length)
            slide.addTable(
                [
                    cells.map(([label]) => headerCell(label, MAROON)),
                    cells.map(([, value]) => ({ text: String(value), options: { fill: { color: 'F2F2F2' }, fontSize: 16, bold: true } }))
                ],
                { x: AREA.x + (AREA.w - w * cells.length) / 2, y, w: w * cells.length, colW: Array(cells.length).fill(w), fontFace: FONT, fontSize: 11, color: TEXT, border: { type: 'solid', color: 'FFFFFF', pt: 1.5 }, align: 'center', valign: 'middle', rowH: [0.6, 0.55] }
            )
        }
        slide.addText('Incubated SMMEs', { x: AREA.x, y: 1.45, w: AREA.w, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: MAROON, align: 'center' })
        tiles([['Total SMMEs', data.smmeTotal], ...data.smmeGroups], 1.85)
        slide.addText(`Enquiries in ${data.month.format('MMMM YYYY')}`, { x: AREA.x, y: 3.6, w: AREA.w, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: MAROON, align: 'center' })
        tiles([['Total enquiries', data.inquiryTotal], ...data.inquiryChannels], 4.0)
    }

    // 9. SMME locality
    {
        const slide = contentSlide('SMME LOCALITY')
        if (!data.localities.length) {
            emptyNote(slide, 'No SMME locations are recorded.')
        } else {
            slide.addChart(
                pptx.ChartType.bar,
                [{ name: 'SMMEs', labels: data.localities.map(([label]) => label), values: data.localities.map(([, value]) => value) }],
                {
                    x: 1.6, y: 1.45, w: 10.1, h: 4.95, barDir: 'col', chartColors: [BLUE],
                    showTitle: true, title: 'Locality', titleFontSize: 14, titleFontFace: FONT,
                    showValue: true, dataLabelFontSize: 10, dataLabelPosition: 'outEnd',
                    catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
                    showCatAxisTitle: true, catAxisTitle: 'LOCATION / AREA', catAxisTitleFontSize: 10,
                    showValAxisTitle: true, valAxisTitle: 'NO. OF SMMES', valAxisTitleFontSize: 10,
                    valGridLine: { color: 'E7E6E6', size: 0.5 }
                }
            )
        }
    }

    // 10. Workshop occupancy
    {
        const pages = chunk(data.workshops, 9)
        if (!pages.length) emptyNote(contentSlide('WORKSHOP OCCUPANCY'), 'No workshops have been captured.')
        pages.forEach(page => {
            const slide = contentSlide('WORKSHOP OCCUPANCY')
            const tableRows: PptxGenJS.TableRow[] = [[
                headerCell('Workshop No.', MAROON), headerCell('SMME', MAROON), headerCell('Trade', MAROON),
                headerCell('Status', MAROON), headerCell('Lease Duration', MAROON), headerCell('Comments', MAROON)
            ]]
            page.forEach((workshop, i) => {
                const fill = { color: i % 2 ? 'FFFFFF' : 'F2F2F2' }
                const status = effectiveLeaseStatus(workshop)
                tableRows.push([
                    { text: workshop.workshopNo, options: { fill, bold: true, align: 'center' } },
                    { text: workshop.smeName || (status === 'Vacant' ? 'Vacant' : '—'), options: { fill } },
                    { text: workshop.trade || '', options: { fill } },
                    { text: status, options: { fill, color: status === 'Lease expired' ? 'C00000' : TEXT } },
                    { text: status === 'Vacant' ? 'N/A' : leaseDuration(workshop), options: { fill } },
                    { text: workshop.comments || '', options: { fill } }
                ])
            })
            slide.addTable(tableRows, { x: AREA.x + 0.2, y: 1.45, w: AREA.w - 0.4, colW: [1.1, 2.4, 2.6, 1.6, 1.9, 2.1], fontFace: FONT, fontSize: 10, color: TEXT, border: { type: 'solid', color: 'FFFFFF', pt: 1 }, valign: 'middle', rowH: 0.42 })
        })
    }

    // 11. Staff attendance heatmap: one row per person, one column per working day.
    {
        const pages = chunk(data.attendance, 12)
        pages.forEach(page => {
            const slide = contentSlide(`STAFF ATTENDANCE - ${data.month.format('MMMM YYYY').toUpperCase()}`)
            const days = page[0]?.days || []
            const nameW = 2.2
            const pctW = 0.75
            const dayW = Math.min(0.42, (AREA.w - nameW - pctW) / Math.max(1, days.length))
            const tableRows: PptxGenJS.TableRow[] = [[
                headerCell('Staff', MAROON),
                ...days.map(day => ({ text: [{ text: day.date.format('dd').charAt(0), options: { fontSize: 7, breakLine: true } }, { text: day.date.format('D') }], options: { bold: true, color: 'FFFFFF', fill: { color: MAROON }, align: 'center' as const } })),
                headerCell('Present', MAROON)
            ]]
            page.forEach(({ person, days: personDays }) => {
                const counted = personDays.filter(day => !['closed', 'upcoming', 'padding'].includes(day.status))
                const present = counted.filter(day => day.status === 'onsite' || day.status === 'remote').length
                tableRows.push([
                    { text: [{ text: person.name, options: { bold: true, breakLine: true } }, { text: person.title, options: { fontSize: 7, color: '595959' } }], options: {} },
                    ...personDays.map(day => ({ text: '', options: { fill: { color: ATTENDANCE_FILL[day.status] || 'FFFFFF' } } })),
                    { text: counted.length ? `${Math.round((present / counted.length) * 100)}%` : '—', options: { bold: true, align: 'center' as const } }
                ])
            })
            const tableW = nameW + dayW * days.length + pctW
            slide.addTable(tableRows, { x: AREA.x + (AREA.w - tableW) / 2, y: 1.4, w: tableW, colW: [nameW, ...days.map(() => dayW), pctW], fontFace: FONT, fontSize: 9, color: TEXT, border: { type: 'solid', color: 'FFFFFF', pt: 1 }, valign: 'middle', rowH: 0.34, margin: 0.03 })
            const legend: Array<[DayStatus, string]> = [['onsite', 'Onsite'], ['remote', 'Remote'], ['leave', 'On leave'], ['absent', 'No record'], ['closed', 'Closed']]
            legend.forEach(([status, label], i) => {
                const x = AREA.x + 0.2 + i * 1.5
                slide.addShape(pptx.ShapeType.rect, { x, y: 6.2, w: 0.25, h: 0.18, fill: { color: ATTENDANCE_FILL[status]! }, line: { color: 'BFBFBF', width: 0.5 } })
                slide.addText(label, { x: x + 0.32, y: 6.17, w: 1.1, h: 0.24, fontFace: FONT, fontSize: 9, color: TEXT, margin: 0 })
            })
        })
    }

    // 12. Needs assessment list
    {
        const total = data.needs.reduce((sum, item) => sum + (item.price || 0), 0)
        const pages = chunk(data.needs, 13)
        if (!pages.length) emptyNote(contentSlide('NEEDS ASSESSMENT LIST: PRICING'), 'No needs have been captured.')
        pages.forEach((page, p) => {
            const slide = contentSlide('NEEDS ASSESSMENT LIST: PRICING')
            const tableRows: PptxGenJS.TableRow[] = [[headerCell('QUANTITY'), headerCell('NEEDS IDENTIFIED'), headerCell('PRODUCT'), headerCell('PRICE')]]
            page.forEach((item, i) => {
                const fill = { color: i % 2 ? 'FFFFFF' : BLUE_LIGHT }
                tableRows.push([
                    { text: String(item.quantity || 1), options: { fill, align: 'center' } },
                    { text: item.need, options: { fill } },
                    { text: item.product, options: { fill } },
                    { text: item.price === null ? '—' : rand(item.price), options: { fill, align: 'right' } }
                ])
            })
            if (p === pages.length - 1) {
                tableRows.push([
                    { text: 'TOTAL', options: { colspan: 3, bold: true, fill: { color: 'D9D9D9' } } },
                    { text: rand(total), options: { bold: true, align: 'right', fill: { color: 'D9D9D9' } } }
                ])
            }
            slide.addTable(tableRows, { x: AREA.x + 0.4, y: 1.4, w: AREA.w - 0.8, colW: [1.2, 3.8, 4.1, 2.2], fontFace: FONT, fontSize: 10, color: TEXT, border: { type: 'solid', color: 'FFFFFF', pt: 1 }, valign: 'middle', rowH: 0.33 })
        })
    }

    // 13. Challenges
    {
        const pages = chunk(data.challenges, 8)
        if (!pages.length) emptyNote(contentSlide('CHALLENGES'), 'No open challenges recorded by centre staff.')
        pages.forEach(page => {
            const slide = contentSlide('CHALLENGES')
            const tableRows: PptxGenJS.TableRow[] = [[headerCell('Challenge', MAROON), headerCell('Solution', MAROON), headerCell('Action', MAROON)]]
            page.forEach((item, i) => {
                const fill = { color: i % 2 ? 'FFFFFF' : 'F2F2F2' }
                tableRows.push([
                    { text: item.challenge, options: { fill } },
                    { text: item.solution, options: { fill } },
                    { text: item.action, options: { fill } }
                ])
            })
            slide.addTable(tableRows, { x: AREA.x + 0.2, y: 1.45, w: AREA.w - 0.4, colW: [5.2, 3.8, 2.7], fontFace: FONT, fontSize: 10, color: TEXT, border: { type: 'solid', color: 'FFFFFF', pt: 1 }, valign: 'middle' })
        })
    }

    // 14. Thank you
    {
        const slide = pptx.addSlide()
        slide.background = { path: template('closing') }
        slide.addText('Thank You', { x: 0.8, y: 1.3, w: 5.5, h: 0.95, fontFace: FONT, fontSize: 54, color: MAROON, margin: 0 })
        slide.addText(data.branchName, { x: 0.9, y: 2.35, w: 5.5, h: 0.45, fontFace: FONT, fontSize: 20, color: MAROON, margin: 0 })
        slide.addText(
            [
                { text: 'Presented by', options: { bold: true, breakLine: true } },
                { text: data.presenter.name, options: { breakLine: true } },
                { text: `${data.presenter.title}, ${data.branchName}`, options: { breakLine: true } },
                { text: 'Lepharo Incubation Programme NPC', options: { breakLine: true } },
                { text: ' ', options: { breakLine: true } },
                { text: 'CONTACT DETAILS:', options: { bold: true, breakLine: true } },
                { text: `E: ${data.presenterEmail}` }
            ],
            { x: 0.9, y: 3.4, w: 4.5, h: 1.6, fontFace: FONT, fontSize: 11, color: TEXT, valign: 'top', margin: 0 }
        )
    }

    const fileName = `${data.branchName.replace(/[^\w]+/g, '_')}_Executive_Operations_Report_${data.month.format('YYYY-MM')}.pptx`
    await pptx.writeFile({ fileName })
    return fileName
}
