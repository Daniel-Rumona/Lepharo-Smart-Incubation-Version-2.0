const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
function load(file) {
  const filename = path.join(__dirname, file)
  const m = new Module(filename, module)
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, filename)
  return m.exports
}
const { trainingInvitees, matchesTrainingCategory, inviteeKey } = load('trainingInvitees.ts')
const { countTrainingCompanies } = load('trainingCompanies.ts')
const company = { id: 'minerals', companyName: 'Minerals Ltd', status: 'enrolled', categories: ['Bricklaying', 'Plumbing'] }
const person = (id, categories, extra = {}) => ({ id, enrollmentId: company.id, name: id, categories, status: 'active', attends: true, ...extra })

test('three people from Minerals count as one company, including legacy records', () => {
  assert.equal(countTrainingCompanies([
    company, { ...company, id: 'second', companyName: ' MINERALS  LTD ' }, { ...company, id: 'third' }
  ]), 1)
  assert.equal(countTrainingCompanies([{id: 'a'}, {id: 'b'}]), 2)
})
test('only the person assigned to Bricklaying is invited', () => {
  const people = [person('bricklayer', ['Bricklaying']), person('plumber', ['Plumbing']), person('electrician', ['Electrical'])]
  assert.deepEqual(trainingInvitees([company], people, 'Bricklaying').map(i => i.attendee.id), ['bricklayer'])
  assert.equal(trainingInvitees([company], people, null).length, 3)
})
test('company categories cannot invite people whose personal categories do not match', () => {
  assert.equal(trainingInvitees([company], [person('plumber', ['Plumbing'])], 'Bricklaying').length, 0)
  assert.equal(matchesTrainingCategory(['Plumbing'], 'Bricklaying'), false)
})
test('withdrawn, non-attending and discontinued records do not receive invitations', () => {
  assert.equal(trainingInvitees([company], [person('a', ['Bricklaying'], {status: 'withdrawn'}), person('b', ['Bricklaying'], {attends: false})], 'Bricklaying').length, 0)
  assert.equal(trainingInvitees([{...company, status: 'discontinued'}], [person('c', ['Bricklaying'])], 'Bricklaying').length, 0)
})
test('legacy individual enrollments use their own category, not everyone from the company', () => {
  const rows = [{...company, id: 'brick', categories: ['Bricklaying']}, {...company, id: 'plumb', categories: ['Plumbing']}]
  assert.deepEqual(trainingInvitees(rows, [], 'Bricklaying').map(i => i.enrollment.id), ['brick'])
  assert.notEqual(inviteeKey(company.id, 'a'), inviteeKey(company.id, 'b'))
})
