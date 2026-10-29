const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'planBuilderItems.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { builderKey, uniqueBuilderItems, relabelFromCatalog } = mod.exports

test('a renamed intervention is one intervention, not two', () => {
    const saved = { id: 'iv1', title: 'Old name', source: 'Department' }
    const library = { id: 'iv1', title: 'New name', source: 'Department' }
    assert.equal(builderKey(saved), builderKey(library))
    assert.deepEqual(uniqueBuilderItems([saved, library]), [saved])
})

test('different interventions stay different; id-less items fall back to their title', () => {
    assert.equal(uniqueBuilderItems([{ id: 'a', title: 'X' }, { id: 'b', title: 'X' }]).length, 2)
    assert.equal(uniqueBuilderItems([{ title: 'Same' }, { title: ' same ' }]).length, 1)
})

test('titles come from the library when it still knows the intervention', () => {
    const titles = new Map([['iv1', 'New name']])
    const result = relabelFromCatalog([{ id: 'iv1', title: 'Old name' }, { id: 'gone', title: 'Kept' }], titles)
    assert.deepEqual(result.map(item => item.title), ['New name', 'Kept'])
})

test('relabelling then de-duplicating collapses a stale copy into the live one', () => {
    const titles = new Map([['iv1', 'New name']])
    const merged = uniqueBuilderItems(relabelFromCatalog(
        [{ id: 'iv1', title: 'Old name', source: 'SME' }, { id: 'iv1', title: 'New name', source: 'Department' }], titles))
    assert.equal(merged.length, 1)
    assert.equal(merged[0].title, 'New name')
})
