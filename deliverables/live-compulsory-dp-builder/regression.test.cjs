const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const file = 'deliverables/live-compulsory-dp-builder/index.tsx';
const source = fs.readFileSync(file, 'utf8');
const helper = source.split('// BEGIN COMPULSORY BUILDER HELPERS')[1].split('// END COMPULSORY BUILDER HELPERS')[0];
const context = {};
vm.runInNewContext(ts.transpileModule(helper + '\nthis.build = buildRequiredPlanItems;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
const catalog = [
    { id: 'gap', interventionTitle: 'Gap Analysis', compulsory: true },
    { id: 'checklist', interventionTitle: 'Checklist', compulsory: true },
    { id: 'optional', interventionTitle: 'Optional' },
    { id: 'another', compulsory: false },
    { id: 'last' }
];
test('automatically includes only the two compulsory definitions', () => {
    const rows = context.build([], catalog);
    assert.equal(rows.length, 2);
    assert.equal(rows.map(x => x.id).join(','), 'gap,checklist');
});
test('preserves SME selections and avoids duplicates even if the title changed', () => {
    const rows = context.build([{ id: 'gap', title: 'Old title', source: 'SME' }, { id: 'optional', title: 'Chosen optional', source: 'Department' }], catalog);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].source, 'SME');
    assert.equal(rows.filter(x => x.id === 'gap').length, 1);
    assert.equal(context.build(rows, catalog).length, 3);
});
test('switching compulsory off stops automatic inclusion without deleting selected work', () => {
    const optionalCatalog = catalog.map(x => ({ ...x, compulsory: false }));
    assert.equal(context.build([], optionalCatalog).length, 0);
    assert.equal(context.build([{ id: 'gap', title: 'Gap', source: 'Department' }], optionalCatalog).length, 1);
});
test('complete live replacement has valid TSX syntax', () => {
    const output = ts.transpileModule(source, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
    assert.equal((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
});
