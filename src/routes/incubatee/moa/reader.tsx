// src/components/MOAReader.tsx
import React, { useMemo } from 'react'
import { Layout, Affix, Typography, Space } from 'antd'
import {
  MoaVars,
  renderMoaPages
} from '@/components/modals/Contracts/moa.pages'

const { Sider, Content } = Layout
const { Link: AnchorLink } = Typography

type Props = { vars: MoaVars }

// Matches: "1", "1.1", "1.1.1", "1.1.1.1" optionally followed by a dot, then space + text
const HEADING_RE = '/^(d+(?:.d+){0,3})(?:.)?s+(.*)$'

type Section = { id: string; title: string; level: number; number: string }

function toId (num: string) {
  return `clause-${num.replace(/\./g, '-')}`
}

function extractSections (pages: string[]): Section[] {
  const sections: Section[] = []
  pages.forEach(page =>
    page.split(/\r?\n/).forEach(line => {
      const m = line.trim().match(HEADING_RE)
      if (m) {
        const number = m[1]
        const titleRest = m[2]
        const level = number.split('.').length // 1 => H2, 2 => H3, etc.
        sections.push({
          id: toId(number),
          title: `${number}. ${titleRest}`.trim(),
          level,
          number
        })
      }
    })
  )
  return sections
}

export default function MOAReader ({ vars }: Props) {
  const pages = useMemo(() => renderMoaPages(vars), [vars])
  const sections = useMemo(() => extractSections(pages), [pages])

  return (
    <Layout style={{ background: 'white' }}>
      <Content style={{ paddingLeft: 8, background: 'white' }}>
        {pages.map((page, pageIdx) => {
          const lines = page.split(/\r?\n/)
          return (
            <div key={pageIdx} style={{ marginBottom: 32 }}>
              {lines.map((line, i) => {
                const m = line.trim().match(HEADING_RE)
                if (m) {
                  const number = m[1]
                  const id = toId(number)
                  return (
                    <React.Fragment key={i}>
                      {/* anchor target with offset for fixed headers */}
                      <div id={id} style={{ position: 'relative', top: -80 }} />
                      <pre
                        style={{
                          whiteSpace: 'pre-wrap',
                          lineHeight: 1.65,
                          fontSize: 14,
                          margin: 0,
                          fontWeight: 600 // make headings stand out a bit
                        }}
                      >
                        {line}
                      </pre>
                    </React.Fragment>
                  )
                }
                return (
                  <pre
                    key={i}
                    style={{
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.65,
                      fontSize: 14,
                      margin: 0
                    }}
                  >
                    {line}
                  </pre>
                )
              })}
              {pageIdx < pages.length - 1 && (
                <div
                  style={{
                    borderTop: '1px dashed var(--ant-color-border)',
                    marginTop: 16,
                    paddingTop: 16
                  }}
                />
              )}
            </div>
          )
        })}
      </Content>
    </Layout>
  )
}
