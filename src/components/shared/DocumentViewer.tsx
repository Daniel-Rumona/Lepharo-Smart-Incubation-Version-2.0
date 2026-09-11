import React from 'react'
import { Typography, Empty } from 'antd'

const { Text } = Typography

interface DocumentViewerProps {
  fileUrl: string
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({ fileUrl }) => {
  if (!fileUrl) {
    return <Empty description='No document available' />
  }

  const isPDF = fileUrl.toLowerCase().endsWith('.pdf')
  const isImage = /\.(jpe?g|png|gif|bmp|webp)$/i.test(fileUrl)

  return (
    <div style={{ width: '100%', height: 500 }}>
      {isPDF ? (
        <iframe
          src={fileUrl}
          title='PDF Viewer'
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      ) : isImage ? (
        <img
          src={fileUrl}
          alt='Uploaded MOV'
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      ) : (
        <Text type='secondary'>Unsupported document format</Text>
      )}
    </div>
  )
}

export default DocumentViewer
