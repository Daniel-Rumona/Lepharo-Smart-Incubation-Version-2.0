const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { loadTs } = require('../../scripts/digital-twin/validate.cjs');

test('Excel import preserves Inactive as distinct from Dormant and normalises Potential Exit', () => {
  const file = path.resolve(__dirname, '../../src/routes/shared/incubatees/import/workbook.ts');
  const m = new Module(file, module);
  m.require = name => name === '@/routes/operations/participants/new/registration'
    ? loadTs('src/routes/operations/participants/new/registration.ts') : require(name);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
  assert.equal(m.exports.statusFromText('Inactive'), 'Inactive');
  assert.equal(m.exports.statusFromText('Dormant'), 'Dormant');
  assert.equal(m.exports.statusFromText('Potential exit'), 'Potential Exit');
});

test('status filter stays available and selects only the requested category', () => {
  const { buildChoices, matchesChoices, DEFAULT_PARTICIPANT_FILTERS } = loadTs('src/routes/shared/incubatees/participantFilterDefs.ts');
  const rows = [{ incubationStatus: 'Inactive' }, { incubationStatus: 'Dormant' }];
  const choice = buildChoices([], { showHub: false }).find(c => c.key === 'incubationStatus');
  assert.ok(choice.values.includes('Potential Exit'));
  const filters = { ...DEFAULT_PARTICIPANT_FILTERS, incubationStatus: 'Dormant' };
  assert.deepEqual(rows.filter(row => matchesChoices(row, filters, ['incubationStatus'])), [rows[1]]);
});
