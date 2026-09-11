const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')

function fixture() {
    const calls = [], urls = [], failures = new Set()
    const filename = require('node:path').join(__dirname, 'coveragePhotoService.ts')
    const loaded = new Module(filename, module)
    loaded.require = name => {
        assert.equal(name, 'firebase/storage')
        return {
            ref: (storage, path) => ({ storage, path }),
            uploadBytes: async (ref, file) => {
                calls.push({ ref, file })
                if (failures.has(file.name)) throw new Error('storage/unauthorized')
            },
            getDownloadURL: async ref => {
                const url = 'https://example.test/' + ref.path
                urls.push(url)
                return url
            }
        }
    }
    loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText, filename)
    return { ...loaded.exports, calls, urls, failures, storage: {} }
}
const photo = name => new File(['photo bytes'], name, { type: 'image/jpeg' })

test('raw File and Ant Upload wrappers both upload; no selected photo is silently dropped', async () => {
    const f = fixture(), raw = photo('raw.jpg'), wrapped = photo('wrapped.jpg')
    const urls = await f.uploadCoveragePhotos(f.storage, 'session-invitation', [raw, { originFileObj: wrapped }])
    assert.deepEqual(f.calls.map(call => call.file), [raw, wrapped])
    assert.deepEqual(urls, f.urls)
    assert.equal(urls.length, 2)
})

test('a missing file or empty file rejects the whole selection before any upload', async () => {
    const f = fixture()
    for (const invalid of [{ uid: 'lost', name: 'lost.jpg' }, new File([], 'empty.jpg'), null]) {
        await assert.rejects(f.uploadCoveragePhotos(f.storage, 'session', [photo('good.jpg'), invalid]), /could not be read/)
    }
    assert.equal(f.calls.length, 0)
})

test('optional photos allow an empty selection, but never a malformed selection', async () => {
    const f = fixture()
    assert.deepEqual(await f.uploadCoveragePhotos(f.storage, 'session', []), [])
    await assert.rejects(f.uploadCoveragePhotos(f.storage, 'session', undefined), /select the photos again/)
})

test('one failed upload rejects saving; retry reuses successful uploads', async () => {
    const f = fixture(), good = photo('good.jpg'), bad = photo('retry.jpg')
    f.failures.add(bad.name)
    await assert.rejects(f.uploadCoveragePhotos(f.storage, 'session', [good, bad]), /Could not upload photo "retry.jpg"/)
    f.failures.clear()
    const result = await f.uploadCoveragePhotos(f.storage, 'session', [good, bad])
    assert.equal(result.length, 2)
    assert.equal(f.calls.filter(call => call.file === good).length, 1)
    assert.equal(f.calls.filter(call => call.file === bad).length, 2)
})

test('same-named photos get distinct paths and uploads are scoped to the appointment', async () => {
    const f = fixture(), one = photo('same.jpg'), two = photo('same.jpg')
    const urls = await f.uploadCoveragePhotos(f.storage, 'one', [one, two])
    assert.notEqual(urls[0], urls[1])
    const other = await f.uploadCoveragePhotos(f.storage, 'two', [one])
    assert.notEqual(other[0], urls[0])
})

test('removed photos are not reintroduced by the retry cache', async () => {
    const f = fixture(), one = photo('one.jpg'), two = photo('two.jpg')
    const original = await f.uploadCoveragePhotos(f.storage, 'session', [one, two])
    assert.deepEqual(await f.uploadCoveragePhotos(f.storage, 'session', [two]), [original[1]])
})

test('server confirmation requires every expected URL, not a local photo preview', () => {
    const f = fixture()
    for (const actual of [undefined, [], ['first']]) {
        assert.throws(() => f.assertCoveragePhotosSaved(['first', 'second'], actual), /could not be verified/)
    }
    assert.doesNotThrow(() => f.assertCoveragePhotosSaved(['first', 'second'], ['second', 'first', 'third']))
    assert.doesNotThrow(() => f.assertCoveragePhotosSaved([], undefined))
})

test('photo removal is verified even when the last image is removed', () => {
    const f = fixture()
    assert.doesNotThrow(() => f.assertCoveragePhotosSaved([], [], ['removed']))
    assert.throws(() => f.assertCoveragePhotosSaved([], ['removed'], ['removed']), /could not be verified/)
    assert.throws(() => f.assertCoveragePhotosSaved(['retained'], ['retained', 'removed'], ['removed']), /could not be verified/)
    assert.doesNotThrow(() => f.assertCoveragePhotosSaved(['retained'], ['retained'], ['removed']))
})
