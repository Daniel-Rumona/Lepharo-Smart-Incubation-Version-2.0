"use strict";
/*
  SME jobs for the digital twin: the minimum of src/lib/jobs.ts, ported to
  plain Dates because functions/ can't import the web app's src/. Keep the two
  in step; src/lib/jobs.ts is the reference.

  hseJobContracts holds one record per uploaded document; a job is one person
  in one position (renewals and re-uploads are the same job).
    starting headcount = application.jobsBaseline (frozen at acceptance), else
                         derived from participant.headcountHistory just before
                         the programme start
    active(D)          = jobs started on/before D and not ended by D
    sustained(D)       = min(starting headcount, active(D))
    created(D)         = max(0, active(D) - starting headcount)
    created in [S, E]  = created(E) - created(day before S), floored at 0
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.twinJobsCreatedInPeriod = exports.countTwinJobsOn = exports.twinJobsBaseline = exports.baselineFromHeadcountHistory = exports.programmeStartOf = exports.isTwinJobActiveOn = exports.groupTwinJobs = exports.normalizeJobContractType = void 0;
const PERMANENT_PLACEHOLDER_YEAR = 2030;
const MONTH_NAMES = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clean = (value) => String(value ?? '').trim().toLowerCase();
const toDateValue = (value) => {
    if (value === undefined || value === null || value === '')
        return null;
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value?.toDate === 'function') {
        const d = value.toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (typeof value?.seconds === 'number')
        return new Date(value.seconds * 1000);
    if (typeof value === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(value.trim())) {
        const [y, m, d] = value.trim().split('-').map(Number);
        return new Date(y, m - 1, d || 1);
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
const normalizeJobContractType = (value) => clean(value) === 'permanent' ? 'permanent' : 'temporary';
exports.normalizeJobContractType = normalizeJobContractType;
const jobKeyOf = (c) => c.jobId || [c.applicationId || '', clean(c.employeeName), clean(c.position)].join('::');
const contractMonth = (c) => {
    const fromDate = toDateValue(c.uploadMonthDate);
    if (fromDate)
        return startOfMonth(fromDate);
    if (c.uploadMonth) {
        const d = toDateValue(`${c.uploadMonth}-01`);
        if (d)
            return startOfMonth(d);
    }
    const created = toDateValue(c.createdAt);
    return created ? startOfMonth(created) : null;
};
const realExpiry = (c) => {
    const d = toDateValue(c.contractEndDate);
    if (!d)
        return null;
    if ((0, exports.normalizeJobContractType)(c.contractType) === 'permanent')
        return null;
    if (d.getFullYear() >= PERMANENT_PLACEHOLDER_YEAR && d.getMonth() === 11 && d.getDate() === 31)
        return null;
    return endOfDay(d);
};
const earliest = (dates) => dates.reduce((min, d) => (!min || d < min ? d : min), null);
/** Groups contract documents into jobs: one per person per position. */
function groupTwinJobs(contracts) {
    const byKey = new Map();
    contracts.forEach(c => {
        if (!c?.applicationId)
            return;
        const key = jobKeyOf(c);
        const list = byKey.get(key);
        if (list)
            list.push(c);
        else
            byKey.set(key, [c]);
    });
    return Array.from(byKey.entries()).map(([key, list]) => {
        const sorted = [...list].sort((a, b) => ((contractMonth(b)?.getTime() || 0) - (contractMonth(a)?.getTime() || 0)) ||
            ((toDateValue(b.createdAt)?.getTime() || 0) - (toDateValue(a.createdAt)?.getTime() || 0)));
        const latest = sorted[0];
        const contractType = (0, exports.normalizeJobContractType)(latest.contractType);
        const captured = earliest(sorted.map(c => toDateValue(c.startDate)).filter(Boolean));
        const firstMonth = earliest(sorted.map(contractMonth).filter(Boolean));
        const startRaw = captured || firstMonth;
        const start = startRaw ? startOfDay(startRaw) : null;
        const endedDates = sorted.map(c => toDateValue(c.endedAt)).filter(Boolean);
        const endedAt = endedDates.length
            ? endOfDay(endedDates.reduce((max, d) => (d > max ? d : max)))
            : null;
        const end = endedAt || (contractType === 'temporary' ? realExpiry(latest) : null);
        return { key, applicationId: latest.applicationId, contractType, start, end };
    });
}
exports.groupTwinJobs = groupTwinJobs;
const isTwinJobActiveOn = (job, date) => {
    if (!job.start || job.start > endOfDay(date))
        return false;
    return !job.end || !(job.end < startOfDay(date));
};
exports.isTwinJobActiveOn = isTwinJobActiveOn;
/* ===================== starting headcount ===================== */
const num = (value) => {
    const v = Number(value);
    return Number.isFinite(v) && v > 0 ? v : 0;
};
const totals = (row) => {
    const permanent = num(row?.permanent);
    const temporary = num(row?.temporary);
    const total = row?.total !== undefined && row?.total !== null ? num(row.total) || permanent + temporary : permanent + temporary;
    return { permanent, temporary, total };
};
/** The date an SME joined the programme, from its accepted application. */
const programmeStartOf = (application) => toDateValue(application?.acceptedAt) ||
    toDateValue(application?.decision?.decidedAt) ||
    toDateValue(application?.dateAccepted) ||
    toDateValue(application?.submittedAt) ||
    toDateValue(application?.createdAt);
exports.programmeStartOf = programmeStartOf;
/** The SME's headcount just before `reference`, from participant.headcountHistory. */
function baselineFromHeadcountHistory(participant, reference, now) {
    const ref = endOfMonth(reference || now);
    const monthly = participant?.headcountHistory?.monthly || {};
    const annual = participant?.headcountHistory?.annual || {};
    const label = (d) => `${SHORT[d.getMonth()]} ${d.getFullYear()}`;
    const entries = [];
    Object.entries(monthly).forEach(([key, row]) => {
        if (/^\d{4}-\d{2}$/.test(key)) {
            const [y, m] = key.split('-').map(Number);
            const date = new Date(y, m - 1, 1);
            entries.push({ date, label: label(date), row });
            return;
        }
        const index = MONTH_NAMES.indexOf(clean(key));
        if (index < 0)
            return;
        let date = new Date(ref.getFullYear(), index, 1);
        if (date > ref)
            date = new Date(ref.getFullYear() - 1, index, 1);
        entries.push({ date, label: label(date), row });
    });
    const withStaff = entries.filter(e => totals(e.row).total > 0);
    const before = withStaff.filter(e => !(e.date > ref)).sort((a, b) => b.date.getTime() - a.date.getTime());
    const month = before[0] || withStaff.sort((a, b) => a.date.getTime() - b.date.getTime())[0];
    if (month)
        return { ...totals(month.row), period: month.label };
    const years = Object.keys(annual).filter(y => /^\d{4}$/.test(y) && totals(annual[y]).total > 0);
    const yearBefore = years.filter(y => Number(y) <= ref.getFullYear()).sort().pop();
    const year = yearBefore || years.sort()[0];
    if (year)
        return { ...totals(annual[year]), period: year };
    return { permanent: 0, temporary: 0, total: 0, period: null };
}
exports.baselineFromHeadcountHistory = baselineFromHeadcountHistory;
/** The starting headcount: frozen on the application at acceptance, else derived. */
function twinJobsBaseline(application, participant, now) {
    const frozen = application?.jobsBaseline;
    if (frozen && (frozen.total !== undefined || frozen.permanent !== undefined)) {
        return { ...totals(frozen), period: frozen.period ?? null };
    }
    return baselineFromHeadcountHistory(participant, (0, exports.programmeStartOf)(application), now);
}
exports.twinJobsBaseline = twinJobsBaseline;
/* ===================== counting ===================== */
/** One SME's jobs on a date against its starting headcount. */
function countTwinJobsOn(jobs, baseline, date) {
    const active = jobs.filter(job => (0, exports.isTwinJobActiveOn)(job, date)).length;
    return { active, sustained: Math.min(baseline, active), created: Math.max(0, active - baseline) };
}
exports.countTwinJobsOn = countTwinJobsOn;
/** Net new jobs created in [start, end]: created(end) - created(day before start), floored at 0. */
function twinJobsCreatedInPeriod(jobs, baseline, start, end) {
    const dayBefore = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
    return Math.max(0, countTwinJobsOn(jobs, baseline, end).created - countTwinJobsOn(jobs, baseline, dayBefore).created);
}
exports.twinJobsCreatedInPeriod = twinJobsCreatedInPeriod;
//# sourceMappingURL=jobs.js.map