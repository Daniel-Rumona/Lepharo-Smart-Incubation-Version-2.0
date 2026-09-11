// services/attendanceRegisterService.ts
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import weekday from 'dayjs/plugin/weekday'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
  type Timestamp,
  type QueryConstraint,
} from 'firebase/firestore'
import { hydrateAppointmentViews } from '@/services/appointmentSessionService'

dayjs.extend(isoWeek)
dayjs.extend(weekday)
dayjs.extend(customParseFormat)

export type Delivery =
  | 'physical'
  | 'online'
  | 'hybrid'
  | string

export type Status =
  | 'scheduled'
  | 'done'
  | 'not_done'
  | 'cancelled'
  | 'missed'
  | 'rescheduled'
  | 'completed'
  | string

export type UserConfirmation =
  | 'pending'
  | 'confirmed'
  | 'declined'
  | string

export type MeetingNoteEntry = {
  createdAt?: Date | Timestamp | string | null
  note?: string
  authorName?: string
}

export type AttendanceSession = {
  startedAt?: Date | Timestamp | string | null
  endedAt?: Date | Timestamp | string | null
  durationMinutes?: number | null
  markedBy?: string | null
}

export type AttendanceSummary = {
  finalStatus?: string | null
  attended?: boolean | null
  durationMinutes?: number | null
  note?: string | null
}

export type Appt = {
  id: string
  consultantId: string
  consultantName: string
  participantId: string
  participantName: string
  participantEmail?: string
  participantSignatureUrl?: string
  departmentId?: string
  interventionId: string
  interventionTitle: string
  deliveryMethod: Delivery
  date: string
  startTime: Date | Timestamp | string
  endTime: Date | Timestamp | string
  meetingLink?: string
  location?: string
  status: Status
  userConfirmation: UserConfirmation
  createdAt?: Timestamp | Date | string
  programId?: string
  meetingNotes?: {
    latest?: MeetingNoteEntry
    history?: MeetingNoteEntry[]
  }
  attendanceSession?: AttendanceSession
  attendanceSummary?: AttendanceSummary
}

export type AttendanceRegisterMode = 'sme' | 'intervention'

export type GenerateAttendanceRegisterParams = {
  db: Firestore
  mode: AttendanceRegisterMode
  startDate: string
  endDate: string
  participantId?: string
  participantIds?: string[]
  interventionId?: string
  programId?: string
  fileName?: string
}

export type SmeSignature = {
  participantId?: string
  participantEmail?: string
  participantName?: string
  signatureUrl?: string
}

type UserSignatureRecord = {
  id: string
  uid?: string
  name?: string
  email?: string
  signatureURL?: string
  signatureUrl?: string
  participantId?: string
}

type NormalizedAppointment = {
  id: string
  participantName: string
  consultantName: string
  interventionTitle: string
  deliveryMethod: string
  date: string // YYYY-MM-DD
  start: Date
  end: Date
  locationText: string
  statusText: string
  noteText: string
  signatureUrl: string
  durationMinutes: number
  slotHour: number
  weekdayIndex: number // 0 = Mon ... 4 = Fri
}

type RegisterMeta = {
  title: string
  subjectName: string
  consultantName: string
  deliveryMethod: string
  periodLabel: string
}

type CellStyleKind = 'header-dark' | 'header-light' | 'time' | 'status-good' | 'status-bad' | 'status-warn' | 'status-neutral' | 'body'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const START_HOUR = 8
const END_HOUR = 17

export async function generateAttendanceRegister(
  params: GenerateAttendanceRegisterParams,
): Promise<void> {
  validateParams(params)

  const appointments = await fetchAttendanceRegisterAppointments(params)
  if (!appointments.length) {
    throw new Error('No appointments found for the selected register criteria.')
  }

  const appointmentsWithSignatures = await enrichAppointmentsWithSmeSignatures(
    params.db,
    appointments,
  )

  const normalized = appointmentsWithSignatures.map(normalizeAppointment).sort(compareNormalized)

  const meta = buildRegisterMeta(params, normalized)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Quantilytix Smart Incubator'
  workbook.created = new Date()
  workbook.modified = new Date()
  workbook.calcProperties.fullCalcOnLoad = true

  const registerSheet = workbook.addWorksheet('Register', {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 20 },
  })

  const rawSheet = workbook.addWorksheet('Attendance Data', {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 18 },
  })

  buildRegisterSheet(registerSheet, meta, normalized, params.mode)
  await buildRawSheet(workbook, rawSheet, normalized, params.mode)

  const buffer = await workbook.xlsx.writeBuffer()
  const safeFileName =
    params.fileName?.trim() ||
    defaultFileName(params.mode, meta.subjectName, params.startDate, params.endDate)

  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    safeFileName,
  )
}


async function enrichAppointmentsWithSmeSignatures(
  db: Firestore,
  appointments: Appt[],
): Promise<Appt[]> {
  if (!appointments.length) return appointments

  const emails = uniqueCompact(
    appointments.map((appt) => normalizeEmail(appt.participantEmail)),
  )

  const signaturesByEmail = new Map<string, SmeSignature>()

  for (const chunk of chunkArray(emails, 10)) {
    if (!chunk.length) continue

    try {
      const snap = await getDocs(
        query(collection(db, 'users'), where('email', 'in', chunk)),
      )

      snap.docs.forEach((userDoc) => {
        const data = userDoc.data() as UserSignatureRecord
        const email = normalizeEmail(data.email)
        const signatureUrl = safeText(data.signatureURL || data.signatureUrl)

        if (!email) return

        signaturesByEmail.set(email, {
          participantId: data.uid || data.participantId || userDoc.id,
          participantEmail: email,
          participantName: safeText(data.name),
          signatureUrl,
        })
      })
    } catch (err) {
      console.warn('Failed to fetch SME signatures by email:', err)
    }
  }

  const fallbackSignaturesByParticipantId = new Map<string, SmeSignature>()

  await Promise.all(
    appointments.map(async (appt) => {
      const participantId = safeText(appt.participantId)
      const email = normalizeEmail(appt.participantEmail)

      if (!participantId || email || fallbackSignaturesByParticipantId.has(participantId)) {
        return
      }

      try {
        const userSnap = await getDoc(doc(db, 'users', participantId))
        if (!userSnap.exists()) return

        const data = userSnap.data() as UserSignatureRecord
        fallbackSignaturesByParticipantId.set(participantId, {
          participantId: data.uid || participantId,
          participantEmail: normalizeEmail(data.email),
          participantName: safeText(data.name),
          signatureUrl: safeText(data.signatureURL || data.signatureUrl),
        })
      } catch (err) {
        console.warn('Failed to fetch SME signature by participantId:', err)
      }
    }),
  )

  return appointments.map((appt) => {
    const email = normalizeEmail(appt.participantEmail)
    const signature =
      (email ? signaturesByEmail.get(email) : null) ||
      fallbackSignaturesByParticipantId.get(safeText(appt.participantId)) ||
      null

    return {
      ...appt,
      participantSignatureUrl: signature?.signatureUrl || '',
      participantEmail: email || signature?.participantEmail || appt.participantEmail || '',
      participantName: appt.participantName || signature?.participantName || '',
    }
  })
}

export async function fetchAttendanceRegisterAppointments(
  params: GenerateAttendanceRegisterParams,
): Promise<Appt[]> {
  const {
    db,
    mode,
    participantId,
    participantIds,
    interventionId,
    programId,
    startDate,
    endDate,
  } = params

  // Dates, delivery details and shared attendance state live on the canonical
  // session. Query invitations first, then hydrate their exact v5 sessions.
  const constraints: QueryConstraint[] = []

  if (programId) constraints.push(where('programId', '==', programId))

  if (mode === 'sme') {
    constraints.push(where('smeId', '==', participantId!))
  } else {
    constraints.push(where('interventionId', '==', interventionId!))
  }

  const snap = await getDocs(query(collection(db, 'appointments'), ...constraints))

  const hydrated = await hydrateAppointmentViews(
    snap.docs.map((appointmentDoc) => ({
      id: appointmentDoc.id,
      data: appointmentDoc.data() as any,
    })),
  )

  let rows: Appt[] = hydrated
    .map((data) => {
      return {
        id: String(data.id),
        consultantId: String(data.assigneeId || ''),
        consultantName: String(data.assigneeName || ''),
        participantId: String(data.participantId || ''),
        participantName: String(data.participantName || ''),
        participantEmail: data.participantEmail || '',
        participantSignatureUrl: data.participantSignatureUrl || '',
        departmentId: data.departmentId || '',
        interventionId: String(data.interventionId || ''),
        interventionTitle: String(data.interventionTitle || ''),
        deliveryMethod: data.deliveryMethod || '',
        date: String(data.date || ''),
        startTime: data.startTime as Appt['startTime'],
        endTime: data.endTime as Appt['endTime'],
        meetingLink: data.meetingLink || '',
        location: data.location || '',
        status: (data.status || 'scheduled') as Status,
        userConfirmation: (data.userConfirmation || 'pending') as UserConfirmation,
        createdAt: data.createdAt as Appt['createdAt'],
        programId: data.programId || '',
        meetingNotes: data.meetingNotes,
        attendanceSession: data.attendanceSession,
        attendanceSummary: data.attendanceSummary,
      }
    })
    .filter((item) => item.date && isDateInRange(item.date, startDate, endDate))

  if (mode === 'intervention' && Array.isArray(participantIds) && participantIds.length > 0) {
    const allowed = new Set(
      participantIds.map((id) => String(id || '').trim()).filter(Boolean),
    )
    rows = rows.filter((item) => allowed.has(String(item.participantId || '').trim()))
  }

  return rows
}

function validateParams(params: GenerateAttendanceRegisterParams) {
  if (!params.db) {
    throw new Error('Firestore instance is required.')
  }

  if (!isYmd(params.startDate) || !isYmd(params.endDate)) {
    throw new Error('startDate and endDate must be in YYYY-MM-DD format.')
  }

  if (dayjs(params.startDate).isAfter(dayjs(params.endDate), 'day')) {
    throw new Error('startDate cannot be after endDate.')
  }

  if (params.mode === 'sme' && !params.participantId) {
    throw new Error('participantId is required for SME attendance register generation.')
  }

  if (params.mode === 'intervention' && !params.interventionId) {
    throw new Error('interventionId is required for intervention attendance register generation.')
  }
}

function isYmd(value: string): boolean {
  return dayjs(value, 'YYYY-MM-DD', true).isValid()
}

function isDateInRange(dateValue: string, startDate: string, endDate: string): boolean {
  const d = dayjs(dateValue, 'YYYY-MM-DD', true)
  if (!d.isValid()) return false
  return !d.isBefore(dayjs(startDate), 'day') && !d.isAfter(dayjs(endDate), 'day')
}

function normalizeAppointment(appt: Appt): NormalizedAppointment {
  const start = toJsDate(appt.startTime, appt.date)
  const end = toJsDate(appt.endTime, appt.date, start)

  const wd = dayjs(appt.date).day() // 0 Sun, 1 Mon ... 6 Sat
  const weekdayIndex = wd >= 1 && wd <= 5 ? wd - 1 : -1

  const deliveryText = prettifyDelivery(appt.deliveryMethod)
  const locationText = buildLocationText(appt)
  const noteText = buildNoteText(appt)
  const statusText = deriveAttendanceStatus(appt)
  const durationMinutes = deriveDurationMinutes(appt, start, end)
  const signatureUrl = safeText(appt.participantSignatureUrl)

  return {
    id: appt.id,
    participantName: safeText(appt.participantName),
    consultantName: safeText(appt.consultantName),
    interventionTitle: safeText(appt.interventionTitle),
    deliveryMethod: deliveryText,
    date: appt.date,
    start,
    end,
    locationText,
    statusText,
    noteText,
    signatureUrl,
    durationMinutes,
    slotHour: start.getHours(),
    weekdayIndex,
  }
}

function compareNormalized(a: NormalizedAppointment, b: NormalizedAppointment): number {
  const dateCompare = a.date.localeCompare(b.date)
  if (dateCompare !== 0) return dateCompare
  const timeCompare = a.start.getTime() - b.start.getTime()
  if (timeCompare !== 0) return timeCompare
  return a.id.localeCompare(b.id)
}

function buildRegisterMeta(
  params: GenerateAttendanceRegisterParams,
  rows: NormalizedAppointment[],
): RegisterMeta {
  const first = rows[0]
  const subjectName =
    params.mode === 'sme'
      ? first?.participantName || 'SME'
      : first?.interventionTitle || 'Intervention'

  const consultants = uniqueCompact(rows.map((r) => r.consultantName))
  const deliveryMethods = uniqueCompact(rows.map((r) => r.deliveryMethod))

  return {
    title:
      params.mode === 'sme'
        ? 'SME Attendance Register'
        : 'Intervention Attendance Register',
    subjectName,
    consultantName:
      consultants.length === 1 ? consultants[0] : consultants.length > 1 ? 'Multiple' : '—',
    deliveryMethod:
      deliveryMethods.length === 1
        ? deliveryMethods[0]
        : deliveryMethods.length > 1
          ? 'Multiple'
          : '—',
    periodLabel: `${dayjs(params.startDate).format('DD MMM YYYY')} - ${dayjs(params.endDate).format('DD MMM YYYY')}`,
  }
}

function buildRegisterSheet(
  ws: ExcelJS.Worksheet,
  meta: RegisterMeta,
  rows: NormalizedAppointment[],
  mode: AttendanceRegisterMode,
) {
  const usableRows = rows.filter(
    (r) => r.weekdayIndex >= 0 && r.slotHour >= START_HOUR && r.slotHour <= END_HOUR,
  )

  const groupedWeeks = groupAppointmentsByWeek(usableRows)

  ws.columns = [
    { width: 12 }, // Time
    { width: 24 }, // Mon
    { width: 14 }, // Mon status
    { width: 24 }, // Tue
    { width: 14 }, // Tue status
    { width: 24 }, // Wed
    { width: 14 }, // Wed status
    { width: 24 }, // Thu
    { width: 14 }, // Thu status
    { width: 24 }, // Fri
    { width: 14 }, // Fri status
  ]

  let rowIndex = 1

  ws.mergeCells(rowIndex, 1, rowIndex, 11)
  ws.getCell(rowIndex, 1).value = meta.title
  applyCellStyle(ws.getCell(rowIndex, 1), 'header-dark')
  ws.getRow(rowIndex).height = 24
  rowIndex++

  ws.mergeCells(rowIndex, 1, rowIndex, 11)
  ws.getCell(rowIndex, 1).value =
    mode === 'sme'
      ? `SME: ${meta.subjectName}`
      : `Intervention: ${meta.subjectName}`
  applyCellStyle(ws.getCell(rowIndex, 1), 'header-light')
  rowIndex++

  ws.getCell(rowIndex, 1).value = 'Consultant'
  ws.getCell(rowIndex, 2).value = meta.consultantName
  ws.getCell(rowIndex, 4).value = 'Delivery Method'
  ws.getCell(rowIndex, 5).value = meta.deliveryMethod
  ws.getCell(rowIndex, 7).value = 'Period'
  ws.getCell(rowIndex, 8).value = meta.periodLabel
  styleMetaRow(ws, rowIndex)
  rowIndex += 2

  if (!groupedWeeks.length) {
    ws.mergeCells(rowIndex, 1, rowIndex, 11)
    ws.getCell(rowIndex, 1).value = 'No weekday appointments found in the selected period.'
    applyCellStyle(ws.getCell(rowIndex, 1), 'body')
    ws.getRow(rowIndex).height = 24
    return
  }

  groupedWeeks.forEach((weekBlock, weekIdx) => {
    ws.mergeCells(rowIndex, 1, rowIndex, 11)
    ws.getCell(rowIndex, 1).value = `Week ${weekIdx + 1}`
    applyCellStyle(ws.getCell(rowIndex, 1), 'header-dark')
    ws.getRow(rowIndex).height = 20
    rowIndex++

    const startOfWeek = dayjs(weekBlock.weekStart)

    ws.getCell(rowIndex, 1).value = 'Date'
    applyCellStyle(ws.getCell(rowIndex, 1), 'header-light')

    for (let d = 0; d < 5; d++) {
      const baseCol = 2 + d * 2
      const dateLabel = startOfWeek.add(d, 'day').format('DD-MMM-YY')

      ws.getCell(rowIndex, baseCol).value = dateLabel
      ws.getCell(rowIndex, baseCol + 1).value = ''
      applyCellStyle(ws.getCell(rowIndex, baseCol), 'header-dark')
      applyCellStyle(ws.getCell(rowIndex, baseCol + 1), 'header-dark')
    }
    ws.getRow(rowIndex).height = 20
    rowIndex++

    ws.getCell(rowIndex, 1).value = 'Time'
    applyCellStyle(ws.getCell(rowIndex, 1), 'time')

    for (let d = 0; d < 5; d++) {
      const baseCol = 2 + d * 2
      ws.getCell(rowIndex, baseCol).value = WEEKDAY_LABELS[d]
      ws.getCell(rowIndex, baseCol + 1).value = 'Status'
      applyCellStyle(ws.getCell(rowIndex, baseCol), 'header-dark')
      applyCellStyle(ws.getCell(rowIndex, baseCol + 1), 'header-dark')
    }
    ws.getRow(rowIndex).height = 20
    rowIndex++

    for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
      ws.getCell(rowIndex, 1).value = formatHour(hour)
      applyCellStyle(ws.getCell(rowIndex, 1), 'time')

      for (let d = 0; d < 5; d++) {
        const baseCol = 2 + d * 2
        const item = weekBlock.grid[d]?.[hour] || null

        ws.getCell(rowIndex, baseCol).value = item ? buildSessionCellText(item, mode) : ''
        ws.getCell(rowIndex, baseCol + 1).value = item?.statusText || ''

        applyCellStyle(ws.getCell(rowIndex, baseCol), 'body')
        applyStatusCellStyle(ws.getCell(rowIndex, baseCol + 1), item?.statusText || '')

        ws.getCell(rowIndex, baseCol).alignment = {
          vertical: 'top',
          horizontal: 'left',
          wrapText: true,
        }
        ws.getCell(rowIndex, baseCol + 1).alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
        }
      }

      ws.getRow(rowIndex).height = 42
      rowIndex++
    }

    rowIndex++
  })
}

async function buildRawSheet(
  workbook: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  rows: NormalizedAppointment[],
  mode: AttendanceRegisterMode,
): Promise<void> {
  const headers =
    mode === 'sme'
      ? [
          'Date',
          'Day',
          'Start Time',
          'End Time',
          'Intervention',
          'Consultant',
          'Delivery Method',
          'Location / Link',
          'Attendance Status',
          'Duration (Minutes)',
          'SME Signature',
          'Notes',
        ]
      : [
          'Date',
          'Day',
          'Start Time',
          'End Time',
          'SME',
          'Consultant',
          'Delivery Method',
          'Location / Link',
          'Attendance Status',
          'Duration (Minutes)',
          'SME Signature',
          'Notes',
        ]

  ws.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: h === 'Notes' ? 36 : h === 'SME Signature' ? 22 : h.includes('Location') ? 28 : 20,
  }))

  const headerRow = ws.getRow(1)
  headers.forEach((header, idx) => {
    const cell = headerRow.getCell(idx + 1)
    cell.value = header
    applyCellStyle(cell, 'header-dark')
  })
  headerRow.height = 22

  const signatureImages = await loadSignatureImages(rows)
  const signatureImageIds = new Map(
    Array.from(signatureImages, ([url, image]) => [url, workbook.addImage(image)]),
  )

  rows.forEach((row) => {
    const excelRow = ws.addRow(
      mode === 'sme'
        ? [
            dayjs(row.date).format('DD MMM YYYY'),
            dayjs(row.date).format('dddd'),
            dayjs(row.start).format('HH:mm'),
            dayjs(row.end).format('HH:mm'),
            row.interventionTitle,
            row.consultantName,
            row.deliveryMethod,
            row.locationText,
            row.statusText,
            row.durationMinutes,
            row.signatureUrl ? '' : 'Missing',
            row.noteText,
          ]
        : [
            dayjs(row.date).format('DD MMM YYYY'),
            dayjs(row.date).format('dddd'),
            dayjs(row.start).format('HH:mm'),
            dayjs(row.end).format('HH:mm'),
            row.participantName,
            row.consultantName,
            row.deliveryMethod,
            row.locationText,
            row.statusText,
            row.durationMinutes,
            row.signatureUrl ? '' : 'Missing',
            row.noteText,
          ],
    )

    const imageId = signatureImageIds.get(row.signatureUrl)
    if (imageId !== undefined) {
      ws.addImage(imageId, {
        tl: { col: 10.15, row: excelRow.number - 0.9 },
        ext: { width: 120, height: 42 },
        editAs: 'oneCell',
      })
      excelRow.height = 36
    } else if (row.signatureUrl) {
      excelRow.getCell(11).value = {
        text: 'Signature unavailable',
        hyperlink: row.signatureUrl,
      }
    }
  })

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    if (row.height < 36 && rows[rowNumber - 2]?.signatureUrl) row.height = 36
    row.eachCell((cell, colNumber) => {
      cell.border = thinBorder()
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber === ws.columnCount ? 'left' : 'center',
        wrapText: true,
      }
      if (headers[colNumber - 1] === 'Attendance Status') {
        applyStatusCellStyle(cell, String(cell.value || ''))
      }

      if (headers[colNumber - 1] === 'SME Signature') {
        const hasHyperlink = typeof cell.value === 'object' && !!(cell.value as any)?.hyperlink
        cell.font = hasHyperlink
          ? { color: { argb: 'FF1677FF' }, underline: true, bold: true }
          : { color: { argb: 'FFFF4D4F' }, bold: true }
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      }
    })
  })
}

type ExcelSignatureImage = {
  base64: string
  extension: 'png' | 'jpeg' | 'gif'
}

async function loadSignatureImages(
  rows: NormalizedAppointment[],
): Promise<Map<string, ExcelSignatureImage>> {
  const urls = uniqueCompact(rows.map((row) => row.signatureUrl))
  const loaded = await Promise.all(
    urls.map(async (url) => [url, await fetchSignatureImage(url)] as const),
  )

  return new Map(
    loaded.filter((entry): entry is readonly [string, ExcelSignatureImage] => !!entry[1]),
  )
}

async function fetchSignatureImage(url: string): Promise<ExcelSignatureImage | null> {
  try {
    if (url.startsWith('data:image/')) {
      const extension = excelImageExtension(url.slice(5, url.indexOf(';')))
      if (extension) return { base64: url, extension }
    }

    const response = await fetch(url)
    if (!response.ok) return null

    const blob = await response.blob()
    const extension = excelImageExtension(blob.type)
    if (extension) {
      return { base64: await blobToDataUrl(blob), extension }
    }

    return { base64: await convertBlobToPng(blob), extension: 'png' }
  } catch (error) {
    console.warn('Unable to embed attendance signature image:', error)
    return null
  }
}

function excelImageExtension(mimeType: string): ExcelSignatureImage['extension'] | null {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('png')) return 'png'
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpeg'
  if (normalized.includes('gif')) return 'gif'
  return null
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('Could not read signature image.'))
    reader.readAsDataURL(blob)
  })
}

async function convertBlobToPng(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create a canvas for the signature image.')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.toDataURL('image/png')
}

function styleMetaRow(ws: ExcelJS.Worksheet, rowIndex: number) {
  const cells = [1, 2, 4, 5, 7, 8]
  cells.forEach((col) => {
    ws.getCell(rowIndex, col).border = thinBorder()
    ws.getCell(rowIndex, col).alignment = {
      vertical: 'middle',
      horizontal: col % 2 === 1 ? 'center' : 'left',
      wrapText: true,
    }
    if (col % 2 === 1) {
      ws.getCell(rowIndex, col).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      ws.getCell(rowIndex, col).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0B5D7C' },
      }
    } else {
      ws.getCell(rowIndex, col).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF2F8FC' },
      }
    }
  })
  ws.getRow(rowIndex).height = 20
}

function applyCellStyle(cell: ExcelJS.Cell, kind: CellStyleKind) {
  cell.border = thinBorder()

  if (kind === 'header-dark') {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0B5D7C' },
    }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    return
  }

  if (kind === 'header-light') {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9EEF7' },
    }
    cell.font = { bold: true, color: { argb: 'FF102A43' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    return
  }

  if (kind === 'time') {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF9FD0E4' },
    }
    cell.font = { bold: true, color: { argb: 'FF102A43' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    return
  }

  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFFFFF' },
  }
  cell.font = { color: { argb: 'FF1F2937' } }
  cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true }
}

function applyStatusCellStyle(cell: ExcelJS.Cell, statusText: string) {
  const normalized = String(statusText || '').trim().toLowerCase()
  cell.border = thinBorder()
  cell.font = { bold: true, color: { argb: 'FF102A43' } }
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }

  if (['done', 'attended', 'completed', 'confirmed'].includes(normalized)) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFC6EFCE' },
    }
    return
  }

  if (['not done', 'missed', 'cancelled', 'declined'].includes(normalized)) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC7CE' },
    }
    return
  }

  if (['pending', 'scheduled', 'rescheduled'].includes(normalized)) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFEB9C' },
    }
    return
  }

  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  }
}

function thinBorder(): Partial<ExcelJS.Borders> {
  return {
    top: { style: 'thin', color: { argb: 'FF333333' } },
    left: { style: 'thin', color: { argb: 'FF333333' } },
    bottom: { style: 'thin', color: { argb: 'FF333333' } },
    right: { style: 'thin', color: { argb: 'FF333333' } },
  }
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}h00`
}

function buildSessionCellText(
  row: NormalizedAppointment,
  mode: AttendanceRegisterMode,
): string {
  const title = mode === 'sme' ? row.interventionTitle : row.participantName
  const parts = [
    title,
    row.consultantName ? `Consultant: ${row.consultantName}` : '',
    row.deliveryMethod ? `Method: ${row.deliveryMethod}` : '',
    row.locationText ? row.locationText : '',
  ].filter(Boolean)

  return parts.join('\n')
}

function deriveAttendanceStatus(appt: Appt): string {
  const summaryStatus = String(appt.attendanceSummary?.finalStatus || '').trim().toLowerCase()
  if (summaryStatus) {
    if (['attended', 'present', 'done', 'completed', 'confirmed'].includes(summaryStatus)) {
      return 'Done'
    }
    if (['missed', 'absent', 'not_done', 'not done'].includes(summaryStatus)) {
      return 'Not Done'
    }
    if (['cancelled', 'canceled'].includes(summaryStatus)) {
      return 'Cancelled'
    }
    if (['rescheduled'].includes(summaryStatus)) {
      return 'Rescheduled'
    }
    if (['pending', 'scheduled'].includes(summaryStatus)) {
      return 'Pending'
    }
  }

  const attended = appt.attendanceSummary?.attended
  if (attended === true) return 'Done'
  if (attended === false) return 'Not Done'

  const sessionStarted = !!appt.attendanceSession?.startedAt
  const sessionEnded = !!appt.attendanceSession?.endedAt
  if (sessionStarted || sessionEnded) return 'Done'

  const appointmentStatus = String(appt.status || '').trim().toLowerCase()
  if (['done', 'completed'].includes(appointmentStatus)) return 'Done'
  if (['cancelled', 'canceled'].includes(appointmentStatus)) return 'Cancelled'
  if (['missed', 'not_done', 'not done'].includes(appointmentStatus)) return 'Not Done'
  if (['rescheduled'].includes(appointmentStatus)) return 'Rescheduled'
  if (['scheduled', 'pending'].includes(appointmentStatus)) return 'Pending'

  const userConfirmation = String(appt.userConfirmation || '').trim().toLowerCase()
  if (userConfirmation === 'confirmed') return 'Done'
  if (userConfirmation === 'declined') return 'Not Done'

  return 'Pending'
}

function buildLocationText(appt: Appt): string {
  const location = safeText(appt.location)
  const link = safeText(appt.meetingLink)

  if (location) return location
  if (link) return 'Online'
  return prettifyDelivery(appt.deliveryMethod) === 'Online' ? 'Online' : '—'
}

function buildNoteText(appt: Appt): string {
  const latest = safeText(appt.meetingNotes?.latest?.note)
  const summary = safeText(appt.attendanceSummary?.note)
  return latest || summary || ''
}

function deriveDurationMinutes(appt: Appt, start: Date, end: Date): number {
  const fromSummary = Number(appt.attendanceSummary?.durationMinutes)
  if (Number.isFinite(fromSummary) && fromSummary > 0) return Math.round(fromSummary)

  const fromSession = Number(appt.attendanceSession?.durationMinutes)
  if (Number.isFinite(fromSession) && fromSession > 0) return Math.round(fromSession)

  const diff = Math.round((end.getTime() - start.getTime()) / 60000)
  return diff > 0 ? diff : 0
}

function prettifyDelivery(value: string): string {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return '—'
  if (normalized === 'online') return 'Online'
  if (normalized === 'physical') return 'Physical'
  if (normalized === 'hybrid') return 'Hybrid'
  return normalized
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function safeText(value: unknown): string {
  return String(value || '').trim()
}

function toJsDate(
  value: Date | Timestamp | string | null | undefined,
  fallbackDateYmd?: string,
  fallbackDateObj?: Date,
): Date {
  if (!value) {
    if (fallbackDateObj) return fallbackDateObj
    if (fallbackDateYmd) return dayjs(fallbackDateYmd, 'YYYY-MM-DD').toDate()
    return new Date()
  }

  if (value instanceof Date) return value

  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate()
  }

  if (typeof value === 'string') {
    const direct = dayjs(value)
    if (direct.isValid()) return direct.toDate()

    const timeOnly = dayjs(value, ['HH:mm', 'HH:mm:ss', 'h:mm A', 'h:mm:ss A'], true)
    if (timeOnly.isValid()) {
      const base = fallbackDateYmd
        ? dayjs(fallbackDateYmd, 'YYYY-MM-DD')
        : fallbackDateObj
          ? dayjs(fallbackDateObj)
          : dayjs()
      return base
        .hour(timeOnly.hour())
        .minute(timeOnly.minute())
        .second(timeOnly.second())
        .millisecond(0)
        .toDate()
    }
  }

  if (fallbackDateObj) return fallbackDateObj
  if (fallbackDateYmd) return dayjs(fallbackDateYmd, 'YYYY-MM-DD').toDate()
  return new Date()
}

function uniqueCompact(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)))
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function defaultFileName(
  mode: AttendanceRegisterMode,
  subjectName: string,
  startDate: string,
  endDate: string,
): string {
  const slug = subjectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)

  return `${mode}_attendance_register_${slug || 'export'}_${startDate}_to_${endDate}.xlsx`
}

function groupAppointmentsByWeek(rows: NormalizedAppointment[]) {
  const weekMap = new Map<
    string,
    {
      weekStart: string
      grid: Record<number, Record<number, NormalizedAppointment>>
    }
  >()

  rows.forEach((row) => {
    const weekStart = dayjs(row.date).startOf('isoWeek').format('YYYY-MM-DD')
    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, {
        weekStart,
        grid: {
          0: {},
          1: {},
          2: {},
          3: {},
          4: {},
        },
      })
    }

    const block = weekMap.get(weekStart)!
    if (row.weekdayIndex >= 0 && row.weekdayIndex <= 4) {
      const existing = block.grid[row.weekdayIndex][row.slotHour]
      if (!existing) {
        block.grid[row.weekdayIndex][row.slotHour] = row
      } else {
        block.grid[row.weekdayIndex][row.slotHour] = mergeSameSlot(existing, row)
      }
    }
  })

  return Array.from(weekMap.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

function mergeSameSlot(
  a: NormalizedAppointment,
  b: NormalizedAppointment,
): NormalizedAppointment {
  const joinedTitle = uniqueCompact([a.interventionTitle, b.interventionTitle]).join(' | ')
  const joinedParticipant = uniqueCompact([a.participantName, b.participantName]).join(' | ')
  const joinedConsultant = uniqueCompact([a.consultantName, b.consultantName]).join(' | ')
  const joinedMethod = uniqueCompact([a.deliveryMethod, b.deliveryMethod]).join(' | ')
  const joinedLocation = uniqueCompact([a.locationText, b.locationText]).join(' | ')
  const joinedStatus = uniqueCompact([a.statusText, b.statusText]).join(' / ')
  const joinedNote = uniqueCompact([a.noteText, b.noteText]).join(' | ')
  const joinedSignature = a.signatureUrl || b.signatureUrl || ''

  return {
    ...a,
    participantName: joinedParticipant,
    consultantName: joinedConsultant,
    interventionTitle: joinedTitle,
    deliveryMethod: joinedMethod,
    locationText: joinedLocation,
    statusText: joinedStatus,
    noteText: joinedNote,
    signatureUrl: joinedSignature,
    durationMinutes: Math.max(a.durationMinutes, b.durationMinutes),
  }
}
