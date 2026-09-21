const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const file = 'deliverables/live-compulsory-roadmap/index.tsx';
const source = fs.readFileSync(file, 'utf8');
const helper = source.split('// BEGIN COMPULSORY ROADMAP HELPERS')[1].split('// END COMPULSORY ROADMAP HELPERS')[0];
const ctx = {};
vm.runInNewContext(ts.transpileModule(helper + '\nthis.only = isCompulsoryOnly; this.required = isCompulsoryItem;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, ctx);
const catalog = [{ id: 'a', compulsory: true }, { id: 'b', compulsory: true }, { id: 'c', compulsory: false }];
test('compulsory-only departments need no sign-off', () => assert.equal(ctx.only([{ id: 'a' }, { interventionId: 'b' }], catalog), true));
test('mixed and empty departments are not exempt', () => {
    assert.equal(ctx.only([{ id: 'a' }, { id: 'c' }], catalog), false);
    assert.equal(ctx.only([], catalog), false);
});
test('live catalogue controls exemption, including switch-off and missing definitions', () => {
    assert.equal(ctx.only([{ id: 'a', compulsory: true }], [{ id: 'a', compulsory: false }]), false);
    assert.equal(ctx.only([{ id: 'a', compulsory: true }], []), false);
    assert.equal(ctx.required({ id: 'c' }, catalog), false);
});
test('replacement parses as TSX', () => {
    const r = ts.transpileModule(source, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } });
    assert.equal((r.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
});
