const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

function load(file, mocks = {}) {
    const filename = path.resolve(__dirname, file)
    const loaded = new Module(filename, module)
    loaded.paths = module.paths
    const requireOriginal = loaded.require.bind(loaded)
    loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : requireOriginal(name)
    loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        fileName: filename,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.React }
    }).outputText, filename)
    return loaded.exports
}
const { getCoveragePhotoUrls, getCoverageReviewPhotos } = load('../../../lib/coveragePhotos.ts')
const { toAppointmentView } = load('../../../services/appointmentSessionService.ts', {
    'firebase/firestore': {}, '@/firebase': { db: {} }
})
const photo = 'https://example.test/session-photo.jpg'
const row = (photos, patch = {}) => ({
    id: 'invitation', appointmentSessionId: 'session', sessionTitle: 'Business planning', date: '2026-08-28',
    sessionCoverage: { latest: { photos } }, ...patch
})

test('coverage images are deduplicated across the group invitations, not counted per SME', () => {
    const group = row([photo, photo, 'https://example.test/second.jpg'], { _groupMembers: [row([photo, 'https://example.test/second.jpg'])] })
    assert.deepEqual(getCoveragePhotoUrls(group), [photo, 'https://example.test/second.jpg'])
    assert.equal(getCoverageReviewPhotos([group, row([photo])]).length, 2)
})

test('removed session photos are not resurrected by stale group member data', () => {
    const staleMembers = [row([photo, 'https://example.test/removed.jpg'])]
    assert.deepEqual(getCoveragePhotoUrls(row([], { _groupMembers: staleMembers })), [])
    assert.deepEqual(getCoveragePhotoUrls(row([photo], { _groupMembers: staleMembers })), [photo])
    // A legacy group without its own photo field may still project member photos.
    assert.deepEqual(getCoveragePhotoUrls(row(undefined, { _groupMembers: staleMembers })), [photo, 'https://example.test/removed.jpg'])
})

test('edit coverage removes saved photos from draft and verifies even clearing the last photo', () => {
    assert.match(source, /aria-label=\{`Remove saved coverage photo/)
    assert.match(source, /setExistingCoveragePhotoUrls\(current => current.filter\(savedUrl => savedUrl !== url\)\)/)
    assert.match(source, /if \(photos.length \|\| removedPhotoUrls.length\)/)
    assert.match(source, /assertCoveragePhotosSaved\(photos, savedSession.data\(\)\?\.coverage\?\.photos, removedPhotoUrls\)/)
    assert.match(source, /Cancel discards these changes/)
    assert.doesNotMatch(source, /deleteObject\(/)
})

test('review photos keep session labels and do not pull unrelated POE resources', () => {
    assert.deepEqual(getCoverageReviewPhotos([row([photo])]), [{
        url: photo, sessionId: 'session', title: 'Business planning', date: '2026-08-28'
    }])
    assert.deepEqual(getCoveragePhotoUrls(row(undefined, { resources: [{ type: 'image', link: photo }] })), [])
    assert.deepEqual(getCoveragePhotoUrls(row([null, {}, 'javascript:alert(1)', '', photo])), [photo])
    assert.equal(getCoverageReviewPhotos([row([photo]), row([photo], { appointmentSessionId: 'other-session' })]).length, 2)
})

test('canonical session photos survive the appointment read projection after reload', () => {
    const session = {
        coverage: { held: true, photos: [photo], coveredPoints: [], outcomeSummary: 'Covered topics' },
        startAt: { toDate: () => new Date('2026-08-28T09:00:00Z') }, endAt: {},
        title: 'Session', plannedCoverage: [], attendanceSummary: { checkedInCount: 1, checkedOutCount: 0 }, foodMenu: []
    }
    const projected = toAppointmentView('invitation', { appointmentSessionId: 'session', schemaVersion: 5 }, session)
    assert.deepEqual(getCoveragePhotoUrls(projected), [photo])
    assert.deepEqual(getCoveragePhotoUrls(toAppointmentView('invitation', {}, { ...session, coverage: { held: true, photos: [] } })), [])
    assert.equal(toAppointmentView('invitation', {}, { ...session, coverage: { held: null, photos: [photo] } }).sessionCoverage.latest, null)
})

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8')
const ast = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const all = []
function visit(node) { all.push(node); ts.forEachChild(node, visit) }
visit(ast)

test('coverage persists the photo array on appointmentSessions, including an empty array', () => {
    const write = all.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'batch.update' &&
        node.arguments[0]?.getText(ast).includes("'appointmentSessions'") &&
        node.arguments[1]?.properties?.some(property => property.name?.getText(ast) === 'coverage'))
    assert.ok(write)
    const coverage = write.arguments[1].properties.find(node => node.name?.getText(ast) === 'coverage')
    assert.ok(coverage.initializer.properties.some(node => node.name?.getText(ast) === 'photos' && ts.isShorthandPropertyAssignment(node)))
})

test('editable and saved coverage SME tables use five rows with centered pagination', () => {
    assert.match(source, /const COVERAGE_ATTENDANCE_PAGE_SIZE = 5/)
    const tables = all.filter(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'Table' &&
        node.getText(ast).includes('pageSize: COVERAGE_ATTENDANCE_PAGE_SIZE'))
    assert.equal(tables.length, 2)
    tables.forEach(table => assert.match(table.getText(ast), /position: \['bottomCenter'\]/))
    const editable = tables.find(table => table.getText(ast).includes('participantAttendance'))
    assert.match(editable.getText(ast), /preserve/)
    assert.match(source, /coverageForm.getFieldsValue\(true\)/)
    assert.doesNotMatch(source, /slice\(\(coverageAttendancePage - 1\)/)
})

test('data and story review both display coverage images', () => {
    const data = fs.readFileSync(path.join(__dirname, 'SessionReviewModal.tsx'), 'utf8')
    const story = fs.readFileSync(path.join(__dirname, 'SessionReviewStory.tsx'), 'utf8')
    assert.match(data, /photos: getCoverageReviewPhotos\(rows\)/)
    assert.match(data, /CoveragePhotoGallery row=\{row\}/)
    assert.match(data, /expandedRowKeys: reviewData.rows.map\(row => row.id\)/)
    assert.doesNotMatch(data, /title: 'Photos'|title: 'Covered'/)
    assert.match(story, /CoverageStoryCarousel photos=\{reviewData.photos \|\| \[\]\}/)
    assert.match(story, /reviewData.photos \|\| \[\]/)
    assert.equal((story.match(/key: 'coverage-topics'/g) || []).length, 1)
    assert.equal((story.match(/key: 'coverage-photos'/g) || []).length, 1)
    const topicsSlide = story.slice(story.indexOf("key: 'coverage-topics'"), story.indexOf("key: 'coverage-photos'"))
    const photosSlide = story.slice(story.indexOf("key: 'coverage-photos'"), story.indexOf('if (upcoming.length)', story.indexOf("key: 'coverage-photos'")))
    assert.match(topicsSlide, /CoverageTopicsStory topics=\{coveredItems\}/)
    assert.doesNotMatch(topicsSlide, /CoverageStoryCarousel/)
    assert.doesNotMatch(photosSlide, /coveredItems|CoverageTopicsStory/)
})

test('story carousel stays one image tall and preserves portrait/landscape framing', () => {
    const React = require('react')
    const { renderToStaticMarkup } = require('react-dom/server')
    const Carousel = load('./CoverageStoryCarousel.tsx').default
    const photos = getCoverageReviewPhotos(Array.from({ length: 30 }, (_, i) => row([`https://example.test/${i}.jpg`], { appointmentSessionId: `session-${i}` })))
    const html = renderToStaticMarkup(React.createElement(Carousel, { photos }))
    assert.equal((html.match(/<img /g) || []).length, 1)
    assert.match(html, /object-fit:contain/)
    assert.match(html, /height:184px/)
    assert.match(html, /1 \/ 30/)
    assert.match(html, /Next coverage image/)
    const single = renderToStaticMarkup(React.createElement(Carousel, { photos: photos.slice(0, 1) }))
    assert.doesNotMatch(single, /Next coverage image|Previous coverage image/)
    const empty = renderToStaticMarkup(React.createElement(Carousel, { photos: [] }))
    assert.match(empty, /No coverage images saved/)
})

test('carousel arrows, keys and swipes navigate photos without changing story slides', () => {
    const React = require('react')
    let index = 0
    const touch = { current: null }
    const Carousel = load('./CoverageStoryCarousel.tsx', { react: {
        ...React,
        useState: () => [index, value => { index = value }],
        useRef: () => touch,
        useEffect: () => {}
    } }).default
    const photos = getCoverageReviewPhotos([row([photo, 'https://example.test/second.jpg', 'https://example.test/third.jpg'])])
    const render = () => Carousel({ photos })
    const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(flatten)]
    const button = name => flatten(render()).find(node => node.props?.['aria-label'] === name)
    button('Previous coverage image').props.onClick()
    assert.equal(index, 2)
    button('Next coverage image').props.onClick()
    assert.equal(index, 0)
    let prevented = false, stopped = false
    render().props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented = true }, stopPropagation() { stopped = true } })
    assert.equal(index, 1)
    assert.ok(prevented && stopped)
    render().props.onTouchStart({ touches: [{ clientX: 200 }] })
    render().props.onTouchEnd({ changedTouches: [{ clientX: 100 }] })
    assert.equal(index, 2)
    assert.equal(touch.current, null)
})

test('coverage stays bounded and pauses the story while browsing images', () => {
    const story = fs.readFileSync(path.join(__dirname, 'SessionReviewStory.tsx'), 'utf8')
    const viewer = fs.readFileSync(path.join(__dirname, '../../../components/story-viewer/index.tsx'), 'utf8')
    assert.match(story, /pauseOnEnter: Boolean\(reviewData.photos\?\.length\)/)
    assert.match(story, /height: 340/)
    assert.doesNotMatch(story, /overflowY: 'auto'/)
    assert.doesNotMatch(story, /overflowX: 'auto'/)
    assert.match(viewer, /hovering \|\| manuallyPaused \|\| slidePaused/)
    assert.match(viewer, /setSlidePaused\(false\)/)
})

test('coverage topics wrap on their own page and all topics remain reachable through pagination', () => {
    const React = require('react')
    const { renderToStaticMarkup } = require('react-dom/server')
    let page = 0
    const Topics = load('./CoverageTopicsStory.tsx', { react: {
        ...React,
        useState: () => [page, value => { page = value }],
        useEffect: () => {}
    } }).default
    const topics = Array.from({ length: 9 }, (_, i) => ({ topic: `Training topic ${i + 1}`, count: i + 1 }))
    const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(flatten)]
    const observed = []
    for (let index = 0; index < 3; index++) {
        const tree = Topics({ topics })
        const nodes = flatten(tree)
        const rows = nodes.filter(node => node.type === 'li')
        assert.ok(rows.length <= 4)
        observed.push(...rows.map(row => row.props.children[0].props.children))
        const html = renderToStaticMarkup(tree)
        assert.match(html, /overflow-wrap:anywhere/)
        assert.doesNotMatch(html, /<img|text-overflow:ellipsis|overflow-x:auto/)
        nodes.find(node => node.props?.['aria-label'] === 'Next topics').props.onClick()
    }
    assert.deepEqual(observed, topics.map(item => item.topic))
    assert.equal(page, 0)
})

test('overview, saved coverage and review use the same session photo gallery', () => {
    assert.match(source, /CoveragePhotoGallery row=\{selectedAppt\}/)
    assert.match(source, /CoveragePhotoGallery row=\{coverageRecord\}/)
    const React = require('react')
    const { renderToStaticMarkup } = require('react-dom/server')
    // Render our gallery, without loading AntD's full browser-oriented module graph.
    const Image = props => React.createElement('img', props)
    Image.PreviewGroup = ({ children }) => React.createElement('div', null, children)
    const Gallery = load('../../../components/appointments/CoveragePhotoGallery.tsx', {
        '@/lib/coveragePhotos': { getCoveragePhotoUrls },
        antd: {
            Image,
            Space: ({ children }) => React.createElement('div', null, children),
            Typography: { Text: ({ children }) => React.createElement('span', null, children) }
        }
    }).default
    const html = renderToStaticMarkup(React.createElement(Gallery, { row: row([photo, photo, 'https://example.test/second.jpg']) }))
    assert.equal((html.match(/alt="Coverage image/g) || []).length, 2)
    assert.match(html, /src="https:\/\/example.test\/session-photo.jpg"/)
    const empty = renderToStaticMarkup(React.createElement(Gallery, { row: row([]) }))
    assert.match(empty, /No coverage images saved/)
})

test('coverage verifies server photo links before success and keeps picker state during save', () => {
    const handler = source.slice(source.indexOf('const saveCoverage ='), source.indexOf('const openAppointmentCompletionEvidence ='))
    assert.match(handler, /uploadCoveragePhotos\(storage, coverageRecord.id, coveragePhotoFilesRef.current\)/)
    assert.match(handler, /getDocFromServer\(doc\(db, 'appointmentSessions', appointmentSessionId\)\)/)
    assert.ok(handler.indexOf('assertCoveragePhotosSaved(') > handler.indexOf('batch.commit()'))
    assert.ok(handler.indexOf('message.success(') > handler.indexOf('assertCoveragePhotosSaved('))
    assert.match(handler, /if \(!coverageRecord \|\| savingCoverageRef.current\) return/)
    assert.doesNotMatch(handler, /map\(f => f.originFileObj\)/)
    assert.match(source, /coveragePhotoFilesRef.current = fileList/)
    assert.match(source, /disabled=\{savingCoverage\}/)
})
