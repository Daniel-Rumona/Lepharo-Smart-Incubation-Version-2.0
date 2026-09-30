/**
 * Seeds ~2 months of weekday clock-in/clock-out history for training@quantilytix.co.za
 * into the `timesheets` collection, matching the field shape written by
 * src/routes/shared/timesheet/ClockInPage.tsx (handleClockAction / confirmOvertimeCheckout).
 *
 * Safe to re-run: skips any date that already has an entry for this user.
 *
 *   node scripts/seed-training-clockins.mjs
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const bufferModule = require('node:buffer')
if (!bufferModule.SlowBuffer) bufferModule.SlowBuffer = bufferModule.Buffer
const { default: admin } = await import('firebase-admin')

const here = path.dirname(fileURLToPath(import.meta.url))
const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
if (serviceAccount.project_id !== 'lph-smart-inc') throw new Error('Unexpected project')
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()
const Timestamp = admin.firestore.Timestamp

const TARGET_EMAIL = 'training@quantilytix.co.za'

// Mirrors LEGACY_SHIFT / defaultOperatingHours in src/utils/branchOperatingHours.ts,
// used for any user with no assignedBranch (this user has assignedBranch: null).
const SHIFT = { closed: false, opens: '07:00', closes: '15:00' }
const OPENS_MIN = 7 * 60
const CLOSES_MIN = 15 * 60

// A fixed, plausible office point (Johannesburg CBD area) with small per-day jitter,
// matching the shape of other seeded records in this project.
const BASE_LAT = -26.2041
const BASE_LNG = 28.0473
const LOCATION_LABEL = 'Bree Street, Johannesburg, Gauteng'

const clockToMinutes = time => {
    const [h, m] = time.split(':').map(Number)
    return h * 60 + m
}
const minutesToClock = mins => {
    const wrapped = ((mins % 1440) + 1440) % 1440
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}
const calculateWorkedHours = (checkInMin, checkOutMin) => {
    const total = Math.max(0, checkOutMin - checkInMin)
    return `${Math.floor(total / 60)}h ${total % 60}m`
}
const lateBy = checkInMin => `${Math.max(0, checkInMin - OPENS_MIN)}m`
const overtimeStr = checkOutMin => {
    const minutes = Math.max(0, checkOutMin - CLOSES_MIN)
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
const dateKey = date => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

// Deterministic pseudo-random so re-running produces the same dataset.
let seed = 987654321
const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
}
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1))

const authUser = await admin.auth().getUserByEmail(TARGET_EMAIL)
const userId = authUser.uid
console.log(`Seeding timesheets for ${TARGET_EMAIL} (${userId})`)

const existingSnap = await db.collection('timesheets').where('userId', '==', userId).get()
const existingDates = new Set(existingSnap.docs.map(d => d.data().date))
console.log(`Existing entries for this user: ${existingDates.size}`)

const today = new Date()
today.setHours(0, 0, 0, 0)
const start = new Date(today)
start.setMonth(start.getMonth() - 2)

const entries = []
for (let d = new Date(start); d < today; d.setDate(d.getDate() + 1)) {
    const day = d.getDay() // 0 = Sun, 6 = Sat
    if (day === 0 || day === 6) continue // weekends closed, matches defaultOperatingHours()

    const key = dateKey(d)
    if (existingDates.has(key)) continue

    // ~1 in 12 weekdays is a day off (leave/absence) — skip, no entry created.
    if (randInt(1, 12) === 1) continue

    const checkInMin = OPENS_MIN + randInt(-5, 20) // mostly on time, occasionally a few minutes late
    const isOvertimeDay = randInt(1, 8) === 1
    const checkOutMin = isOvertimeDay
        ? CLOSES_MIN + randInt(20, 50)
        : CLOSES_MIN + randInt(-15, 5)

    const checkIn = minutesToClock(checkInMin)
    const checkOut = minutesToClock(checkOutMin)
    const lat = BASE_LAT + (rand() - 0.5) * 0.001
    const lng = BASE_LNG + (rand() - 0.5) * 0.001
    const accuracy = randInt(12, 45)

    const checkInAt = new Date(d)
    checkInAt.setHours(Math.floor(checkInMin / 60), checkInMin % 60, 0, 0)
    const checkOutAt = new Date(d)
    checkOutAt.setHours(Math.floor(checkOutMin / 60) % 24, checkOutMin % 60, 0, 0)

    const entry = {
        userId,
        branchId: null,
        scheduledHours: SHIFT,
        date: key,
        checkIn,
        checkOut,
        status: 'checked_out',

        location: `${lat},${lng}`,
        locationLabel: LOCATION_LABEL,
        detectedLocationLabel: LOCATION_LABEL,
        centerMatched: false,
        latitude: lat,
        longitude: lng,
        locationAccuracy: accuracy,
        locationVerified: true,
        locationQuality: accuracy <= 50 ? 'high' : 'medium',

        locationCaptureFailed: false,
        locationFailureReason: '',

        autoClockedOut: false,
        autoClockOutReason: '',
        auditFlag: '',
        hoursWorked: calculateWorkedHours(checkInMin, checkOutMin),
        lateBy: lateBy(checkInMin),
        overtime: overtimeStr(checkOutMin),
        createdAt: Timestamp.fromDate(checkInAt),
        updatedAt: Timestamp.fromDate(checkOutAt)
    }

    if (isOvertimeDay) {
        entry.overtimeReason = 'Finishing up training material preparation for the next cohort.'
        entry.overtimeRequestedAt = checkOut
        entry.overtimeLocationVerified = false
        entry.overtimeApprovalStatus = 'approved'
        entry.overtimeDecisionByName = 'Seeded historical record'
        entry.overtimeDecisionNote = 'Auto-approved when this dataset was seeded.'
    }

    entries.push(entry)
}

console.log(`Prepared ${entries.length} new entries (${existingDates.size} already existed, skipped).`)

const BATCH_SIZE = 400
for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = db.batch()
    for (const entry of entries.slice(i, i + BATCH_SIZE)) {
        batch.set(db.collection('timesheets').doc(), entry)
    }
    await batch.commit()
    console.log(`Committed ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length}`)
}

console.log('Done.')
