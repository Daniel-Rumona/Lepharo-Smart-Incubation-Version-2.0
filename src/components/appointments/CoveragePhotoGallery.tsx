import React from 'react'
import { Image, Space, Typography } from 'antd'
import { getCoveragePhotoUrls } from '@/lib/coveragePhotos'

/** All coverage views read the same saved session photos. */
const CoveragePhotoGallery: React.FC<{ row: any }> = ({ row }) => {
    const photos = getCoveragePhotoUrls(row)
    if (!photos.length) return <Typography.Text type='secondary'>No coverage images saved.</Typography.Text>

    return (
        <Image.PreviewGroup items={photos}>
            <Space wrap size={8} style={{ display: 'flex' }}>
                {photos.map((url, index) => (
                    <Image
                        key={url}
                        src={url}
                        alt={`Coverage image ${index + 1} for ${row.sessionTitle || row.interventionTitle || 'session'}`}
                        width={112}
                        height={84}
                        style={{ objectFit: 'cover', borderRadius: 6 }}
                    />
                ))}
            </Space>
        </Image.PreviewGroup>
    )
}

export default CoveragePhotoGallery
