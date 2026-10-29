// TEMPORARY: dev-only sample story so the UI can be reviewed. Delete this file and its use in index.tsx.
const pdf = (name: string) => ({ name: `${name}.pdf`, type: 'application/pdf', size: 207000, url: '#', path: `preview/${name}.pdf` })
const benefits = [
    'Gain a basic understanding of Generative AI and its applications.',
    'Learn how AI tools can support everyday business activities.',
    'Improve productivity by using AI to assist with tasks such as content creation, research, communication and administration.',
    'Explore ways of using AI for marketing and customer engagement.',
    'Develop digital skills that can help SMMEs adapt to technological changes.',
    'Increase awareness of responsible and effective use of AI in business.',
    'Encourage SMMEs to explore innovative solutions to existing business challenges.'
].join('\n')
const cover = 'https://firebasestorage.googleapis.com/v0/b/lph-smart-inc.firebasestorage.app/o/success-stories%2FtcECaWjHe0rQ81xIuAdy%2Fcover%2F1790920047525_Screenshot_2026-08-26_095959.png?alt=media&token=96f3d967-a08d-4380-9ae1-c7807fda3a35'

export const previewEventStory: any = {
    id: 'preview-tcECaWjHe0rQ81xIuAdy',
    smeName: 'Lepharo event',
    title: 'Lepharo SMMEs Gain AI Skills Through WeThinkCode_ Online Training',
    storyKind: 'Event',
    source: 'Department',
    departmentId: 'FnbBdir2lWjcDaH75Bj9',
    departmentName: 'Training Academy',
    programId: 'b3qe3WAMAVw3QU64CLIY',
    attendeeCount: 40,
    eventBackground: 'The session was designed to introduce entrepreneurs to the practical use of AI tools and demonstrate how emerging technologies can be applied to improve business operations, productivity, communication, marketing, and decision-making.',
    attendees: 'SMME owners and entrepreneurs who were interested in learning about Artificial Intelligence.\nLepharo staff members who participated in the session.',
    eventBenefits: benefits,
    summary: benefits,
    createdByName: 'Lungile Ngobeni',
    createdAt: { seconds: 1790920047, nanoseconds: 172000000 },
    coverImageUrl: cover,
    attachments: [
        { name: 'Screenshot 2026-08-26 095959.png', type: 'image/png', size: 529544, url: cover, path: 'preview/cover.png' },
        ...['David Malomane', 'Emmah Nothobile Mahume', 'Eric Molokela', 'Ethel Moleseng Lonathemba Twala', 'Fanie Mathumetse', 'Kabelo Kado AI Certificate', 'Kamogelo  Kekae', 'Lebogang Sihlali', 'Mbongeni  Shungube', 'Merry  Shange', 'Nombuso Maseko', 'Nonhlanhla Gladness  Mahlangu', 'Nonyameko Magida', 'Ntombifuthi Xolisile  Mdhluli', 'Rufus Motebang  Ramone', 'Tshepo Mlotywa'].map(pdf)
    ]
}
