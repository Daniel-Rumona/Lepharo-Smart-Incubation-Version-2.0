const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, overrides = {}) {
    const module = { exports: {} };
    let source = fs.readFileSync(file, 'utf8');
    if (file.endsWith('index.tsx')) {
        source = source.split('// BEGIN COMPULSORY DP HELPERS')[1].split('// END COMPULSORY DP HELPERS')[0];
        source = "import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';\nimport { db } from '@/firebase';\n" + source + '\nexport { interventionId, mergeCompulsoryInterventions, isCompulsoryIntervention, eligiblePlanInterventions, ensureCompulsoryPlan };';
        overrides = { 'firebase/firestore': {}, '@/firebase': { db: {} }, ...overrides };
    }
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: name => overrides[name] || require(name) });
    return module.exports;
}
const helpers = load('deliverables/live-compulsory-assignments/index.tsx');
const compulsory = { id: 'mandatory', departmentId: 'dept', interventionTitle: 'Training', compulsory: true };
const optional = { id: 'optional', compulsory: false };
test('ROM projection counts only the two compulsory entries in a five-item catalogue', () => {
    const source = fs.readFileSync('deliverables/live-compulsory-assignments/index.tsx', 'utf8');
    const start = source.indexOf('const monitoringRequiredInterventions =');
    const end = source.indexOf('\n                );', start) + '\n                );'.length;
    assert.ok(start >= 0 && end > start);
    const code = ts.transpileModule(source.slice(start, end) + '\nresult = monitoringRequiredInterventions;', {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const context = {
        departmentInterventions: [
            { id: 'compliance', interventionTitle: 'Compliance Document Verification' },
            { id: 'gap', interventionTitle: 'Gap Analysis', compulsory: true },
            { id: 'checklist', interventionTitle: 'Group A checklist to move SME to Group B', compulsory: true },
            { id: 'maintenance', interventionTitle: 'Maintenance', compulsory: false },
            { id: 'induction', interventionTitle: 'SMME Onboarding Induction' }
        ],
        deptId: 'rom', deptName: 'ROM',
        dedupeInterventions: items => items,
        getActiveSubInterventions: () => [], result: null
    };
    vm.runInNewContext(code, context);
    assert.equal(context.result.length, 2);
    assert.equal(context.result.map(item => item.id).join(','), 'gap,checklist');
    context.departmentInterventions.forEach(item => { item.compulsory = false; });
    const emptyContext = { ...context };
    vm.runInNewContext(code, emptyContext);
    assert.equal(emptyContext.result.length, 0);
});
test('allocation preserves existing requirements and is idempotent across legacy IDs', () => {
    const existing = { interventionId: 'mandatory', title: 'Existing', progress: 50 };
    const result = helpers.mergeCompulsoryInterventions([existing, optional], [compulsory]);
    assert.equal(result.length, 2);
    assert.equal(result[0], existing);
    assert.equal(helpers.mergeCompulsoryInterventions(result, [compulsory]).length, 2);
});
test('compulsory-only and mixed plans expose only compulsory work without confirmation', () => {
    assert.equal(helpers.eligiblePlanInterventions([compulsory], [compulsory], false).length, 1);
    const result = helpers.eligiblePlanInterventions([compulsory, optional], [compulsory, optional], false);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'mandatory');
    assert.equal(helpers.eligiblePlanInterventions([compulsory, optional], [compulsory, optional], true).length, 2);
});
test('turning compulsory off or deleting the definition restores the confirmation gate', () => {
    assert.equal(helpers.eligiblePlanInterventions([compulsory], [{ ...compulsory, compulsory: false }], false).length, 0);
    assert.equal(helpers.eligiblePlanInterventions([compulsory], [], false).length, 0);
    assert.equal(helpers.eligiblePlanInterventions([optional], [optional], false).length, 0);
});
test('allocation creates a program-scoped DP without fabricated signatures and preserves existing signatures', async () => {
    const plans = new Map();
    const firestore = {
        collection: (_db, name) => name, query: (...args) => args, where: (...args) => args,
        getDocs: async () => ({ docs: [] }), doc: (_db, _name, id) => ({ id }),
        serverTimestamp: () => 'timestamp',
        runTransaction: async (_db, action) => action({
            get: async ref => ({ exists: () => plans.has(ref.id), data: () => plans.get(ref.id) }),
            set: (ref, data) => plans.set(ref.id, data)
        })
    };
    const service = load('deliverables/live-compulsory-assignments/index.tsx', {
        'firebase/firestore': firestore, '@/firebase': { db: {} }, '@/utils/compulsoryInterventions': helpers
    });
    const app = { participantId: 'sme', programId: 'program' };
    const plan = await service.ensureCompulsoryPlan(app, [compulsory]);
    assert.equal(plan.interventions.length, 1);
    assert.equal(plan.programId, 'program');
    assert.equal(plan.confirmedByDeptId, undefined);
    assert.equal(plan.smmeConfirmedByDeptId, undefined);
    const existing = { ...plan, interventions: [optional], confirmedByDeptId: { other: true } };
    plans.set(plan.id, existing);
    const updated = await service.ensureCompulsoryPlan(app, [compulsory], existing);
    assert.equal(updated.interventions.length, 2);
    assert.equal(updated.confirmedByDeptId.other, true);
    const other = await service.ensureCompulsoryPlan({ ...app, programId: 'other' }, [compulsory]);
    assert.notEqual(other.id, plan.id);
});
