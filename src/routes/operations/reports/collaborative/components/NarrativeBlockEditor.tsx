import React from 'react'
import { Input } from 'antd'

type Props = {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}

const NarrativeBlockEditor: React.FC<Props> = ({ value, onChange, readOnly }) => (
  <div className="block-editor-body block-editor-textarea">
    <Input.TextArea
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      readOnly={readOnly}
      autoSize={{ minRows: 14 }}
      placeholder="Enter the report narrative for this block..."
    />
  </div>
)

export default NarrativeBlockEditor
