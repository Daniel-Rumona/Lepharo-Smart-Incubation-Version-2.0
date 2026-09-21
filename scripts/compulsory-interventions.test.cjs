const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, overrides = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: name => overrides[name] || require(name) });
    return module.exports;
}
const helpers = load('src/utils/compulsoryInterventions.ts');
const compulsory = { id: 'mandatory', departmentId: 'dept', interventionTitle: 'Training', compulsory: true };
const optional = { id: 'optional', compulsory: false };
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
    const service = load('src/services/compulsoryInterventionService.ts', {
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
