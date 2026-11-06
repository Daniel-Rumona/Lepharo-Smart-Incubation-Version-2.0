// End-to-end tests for certificate PDFs and verification codes, on a real
// fillable PDF built here with pdf-lib. The TypeScript source is transpiled
// in memory, so no build is needed.
//   node --test functions/src/certificatePdf.test.cjs
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const functionsDir = path.join(__dirname, '..')
const load = (name) => require(require.resolve(name, { paths: [functionsDir] }))
const ts = load('typescript')
const { PDFDocument } = load('pdf-lib')

const source = fs.readFileSync(path.join(__dirname, 'certificatePdf.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } })
const mod = { exports: {} }
new Function('module', 'exports', 'require', outputText)(mod, mod.exports, load)
const { renderCertificate, templateFields, verificationCodeFor, normalizeCode } = mod.exports

// A 1x1 red PNG, standing in for a signature image.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'))

async function makeTemplate(fields) {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([842, 595])
    const form = pdf.getForm()
    fields.forEach((name, i) => form.createTextField(name).addToPage(page, { x: 50, y: 500 - i * 60, width: 300, height: 40 }))
    return pdf.save()
}

test('a template\'s form fields are its placeholders', async () => {
    const info = await templateFields(await makeTemplate(['recipientName', 'trainingName', 'signature_1', 'verificationQr']))
    assert.deepEqual(info.fields, ['recipientName', 'trainingName', 'signature_1', 'verificationQr'])
    assert.deepEqual(info.signatureFields, ['signature_1'])
    assert.equal(info.hasRecipientName, true)
    assert.equal(info.hasQr, true)
})

test('issuing fills the text, draws the signature and QR, and leaves nothing editable', async () => {
    const template = await makeTemplate(['recipientName', 'certificateNumber', 'signature_1', 'verificationQr', 'unused'])
    const bytes = await renderCertificate(
        template,
        { recipientName: 'Thandi Mokoena', certificateNumber: 'LPH-TA-2026-000001' },
        [{ field: 'signature_1', image: { bytes: PNG, kind: 'png' } }],
        'https://example.test/verify-certificate?c=AAAA-BBBB-CCCC-DDDD'
    )
    const issued = await PDFDocument.load(bytes)
    assert.equal(issued.getForm().getFields().length, 0, 'flattened')
    assert.ok(bytes.length > template.length, 'images and text were added')
})

test('a preview is watermarked and still renders without signatures', async () => {
    const bytes = await renderCertificate(await makeTemplate(['recipientName']), { recipientName: 'Sample' }, [], null)
    const preview = await PDFDocument.load(bytes)
    assert.equal(preview.getPageCount(), 1)
    assert.equal(preview.getForm().getFields().length, 0)
})

test('the verification code depends on the secret and every identifying detail', () => {
    const cert = { id: 'c1', certificateNumber: 'LPH-TA-2026-000001', recipientName: 'Thandi Mokoena', trainingId: 't1', issuedAt: '2026-10-27T10:00:00.000Z' }
    const code = verificationCodeFor('secret', cert)
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    assert.equal(verificationCodeFor('secret', cert), code, 'stable')
    assert.notEqual(verificationCodeFor('other', cert), code)
    assert.notEqual(verificationCodeFor('secret', { ...cert, recipientName: 'Someone Else' }), code)
    assert.doesNotMatch(code, /[IO01]/)
})

test('codes are accepted however they are typed', () => {
    assert.equal(normalizeCode('7kq2m9xd4hpaw3rt'), '7KQ2-M9XD-4HPA-W3RT')
    assert.equal(normalizeCode(' 7KQ2-M9XD 4HPA-W3RT '), '7KQ2-M9XD-4HPA-W3RT')
    assert.equal(normalizeCode('too-short'), '')
})
