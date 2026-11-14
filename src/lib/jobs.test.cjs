const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const dayjs = require('dayjs')

const filename = path.join(__dirname, 'jobs.ts')
const loaded = new Module(filename, module)
loaded.paths = module.paths
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText, filename)
const {
    groupJobs, countJobsOn, countJobsInPeriod, countProgrammeInPeriod, jobsBaselineFor,
    baselineFromHeadcountHistory, expiringWithin, normalizeContractType
} = loaded.exports

const d = s => dayjs(s)
const doc = (over) => ({
    id: Math.random().toString(36).slice(2),
    applicationId: 'app1',
    employeeName: 'Thandi M',
    position: 'Cashier',
    contractType: 'permanent',
    uploadMonth: '2026-01',
    ...over
})

test('re-uploads of the same person are one job, started at the earliest upload month', () => {
    const jobs = groupJobs([
        doc({ uploadMonth: '2026-03' }),
        doc({ uploadMonth: '2026-01', employeeName: ' thandi m ' }),
        doc({ uploadMonth: '2026-02', position: 'CASHIER' })
    ])
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].start.format('YYYY-MM-DD'), '2026-01-01')
    assert.equal(jobs[0].startIsEstimated, true)
    assert.equal(jobs[0].contracts.length, 3)
})

test('jobId groups renewals even when the name is retyped; a captured start date wins', () => {
    const jobs = groupJobs([
        doc({ jobId: 'j1', startDate: '2025-11-15', uploadMonth: '2026-01' }),
        doc({ jobId: 'j1', employeeName: 'Thandiwe M', uploadMonth: '2026-04' })
    ])
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0].employeeName, 'Thandiwe M')
    assert.equal(jobs[0].start.format('YYYY-MM-DD'), '2025-11-15')
    assert.equal(jobs[0].startIsEstimated, false)
})

test('temporary contracts stop counting after expiry; the 2030 permanent placeholder is not an end', () => {
    const [temp] = groupJobs([doc({ contractType: 'temporal', contractEndDate: '2026-03-31' })])
    assert.equal(normalizeContractType('temporal'), 'temporary')
    assert.equal(countJobsOn([temp], 0, d('2026-03-31')).active, 1)
    assert.equal(countJobsOn([temp], 0, d('2026-04-01')).active, 0)

    const [perm] = groupJobs([doc({ contractEndDate: '2030-12-31' })])
    assert.equal(perm.end, null)
    assert.equal(countJobsOn([perm], 0, d('2035-01-01')).active, 1)
})

test('an ended job stops counting the day after it ends', () => {
    const [job] = groupJobs([doc({ endedAt: '2026-05-10', endReason: 'resigned' })])
    assert.equal(countJobsOn([job], 0, d('2026-05-10')).active, 1)
    assert.equal(countJobsOn([job], 0, d('2026-05-11')).active, 0)
    assert.equal(job.endReason, 'resigned')
})

test('sustained is capped at the starting headcount; the rest are created', () => {
    const jobs = groupJobs([1, 2, 3, 4, 5].map(i => doc({ employeeName: `P${i}` })))
    assert.deepEqual(
        (({ active, sustained, created }) => ({ active, sustained, created }))(countJobsOn(jobs, 3, d('2026-02-01'))),
        { active: 5, sustained: 3, created: 2 }
    )
    // Fewer active than the baseline: all are sustained, none created.
    assert.deepEqual(
        (({ sustained, created }) => ({ sustained, created }))(countJobsOn(jobs.slice(0, 2), 3, d('2026-02-01'))),
        { sustained: 2, created: 0 }
    )
})

test('created in a period is the change in created jobs; starts and losses are reported', () => {
    const jobs = groupJobs([
        doc({ employeeName: 'A', uploadMonth: '2026-01' }),
        doc({ employeeName: 'B', uploadMonth: '2026-01' }),
        doc({ employeeName: 'C', uploadMonth: '2026-02' }),
        doc({ employeeName: 'D', uploadMonth: '2026-02' }),
        doc({ employeeName: 'A', uploadMonth: '2026-02', endedAt: '2026-02-20' })
    ])
    const feb = countJobsInPeriod(jobs, 1, d('2026-02-01'), d('2026-02-28'))
    assert.equal(feb.active, 3) // B, C, D
    assert.equal(feb.sustained, 1)
    assert.equal(feb.created, 2)
    assert.equal(feb.createdInPeriod, 1) // created went 1 -> 2
    assert.equal(feb.started, 2)
    assert.equal(feb.lost, 1)
})

test('programme totals add each SME separately', () => {
    const jobs = groupJobs([
        doc({ applicationId: 'a', employeeName: 'A1' }),
        doc({ applicationId: 'a', employeeName: 'A2' }),
        doc({ applicationId: 'b', employeeName: 'B1' })
    ])
    const baselines = new Map([['a', 0], ['b', 4]])
    const total = countProgrammeInPeriod(jobs, baselines, d('2026-01-01'), d('2026-01-31'), ['a', 'b', 'c'])
    assert.equal(total.active, 3)
    assert.equal(total.created, 2) // b's shortfall doesn't cancel a's growth
    assert.equal(total.sustained, 1)
})

test('starting headcount: latest month on or before the programme start, both key styles', () => {
    const participant = {
        headcountHistory: {
            monthly: {
                '2026-03': { permanent: 4, temporary: 1, total: 5 },
                '2026-05': { permanent: 6, temporary: 0, total: 6 },
                'February': { permanent: 2, temporary: 0 }
            },
            annual: { 2025: { permanent: 9, temporary: 0 } }
        }
    }
    const b = baselineFromHeadcountHistory(participant, d('2026-04-10'))
    assert.deepEqual({ total: b.total, period: b.period, source: b.source }, { total: 5, period: 'Mar 2026', source: 'headcountHistory' })

    const named = baselineFromHeadcountHistory({ headcountHistory: { monthly: { January: { permanent: 3 }, November: { permanent: 7 } } } }, d('2026-02-15'))
    assert.deepEqual({ total: named.total, period: named.period }, { total: 3, period: 'Jan 2026' })

    // Filled in after joining: the earliest entry stands in.
    const late = baselineFromHeadcountHistory({ headcountHistory: { monthly: { '2026-09': { permanent: 2 }, '2026-08': { permanent: 1 } } } }, d('2026-01-01'))
    assert.equal(late.period, 'Aug 2026')

    const yearly = baselineFromHeadcountHistory({ headcountHistory: { annual: { 2024: { permanent: 3 }, 2025: { permanent: 4, temporary: 2 } } } }, d('2026-01-01'))
    assert.deepEqual({ total: yearly.total, period: yearly.period }, { total: 6, period: '2025' })

    assert.equal(baselineFromHeadcountHistory({}, d('2026-01-01')).source, 'none')
})

test('a frozen baseline on the application wins over the live history', () => {
    const b = jobsBaselineFor(
        { acceptedAt: '2026-04-01', jobsBaseline: { permanent: 2, temporary: 1, total: 3, period: 'Mar 2026' } },
        { headcountHistory: { monthly: { '2026-03': { permanent: 40 } } } }
    )
    assert.deepEqual({ total: b.total, source: b.source }, { total: 3, source: 'frozen' })
})

test('expiring soon lists active temporary jobs whose contract ends within the window', () => {
    const jobs = groupJobs([
        doc({ employeeName: 'T1', contractType: 'temporal', contractEndDate: '2026-02-20' }),
        doc({ employeeName: 'T2', contractType: 'temporal', contractEndDate: '2026-06-20' }),
        doc({ employeeName: 'P1' })
    ])
    assert.deepEqual(expiringWithin(jobs, d('2026-02-01'), 30).map(j => j.employeeName), ['T1'])
})
