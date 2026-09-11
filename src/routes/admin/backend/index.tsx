import React, { useEffect, useState } from 'react'
import {
  Layout,
  Menu,
  Card,
  Table,
  Input,
  Typography,
  Select,
  Empty,
  Spin,
  message
} from 'antd'
import {
  collection,
  getDocs,
  query,
  where,
  limit,
  getFirestore
} from 'firebase/firestore'
import { db } from '@/firebase'

const { Content, Sider } = Layout
const { Title } = Typography
const { Option } = Select

const FirestoreAdminPanel = () => {
  const [collections, setCollections] = useState<string[]>([])
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null
  )
  const [documents, setDocuments] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [fields, setFields] = useState<string[]>([])
  const [searchField, setSearchField] = useState<string>('')
  const [searchValue, setSearchValue] = useState<string>('')

  useEffect(() => {
    const fetchCollections = async () => {
      try {
        const firestore = getFirestore()
        const allCollections = await firestore.listCollections()
        const names = allCollections.map(col => col.id)
        setCollections(names)
      } catch (err) {
        message.error('Failed to load collections')
      }
    }
    fetchCollections()
  }, [])

  useEffect(() => {
    if (!selectedCollection) return
    const fetchDocuments = async () => {
      setLoading(true)
      try {
        const colRef = collection(db, selectedCollection)
        let q = colRef
        if (searchField && searchValue) {
          q = query(colRef, where(searchField, '==', searchValue))
        }
        const snapshot = await getDocs(query(q, limit(100)))
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        setDocuments(docs)

        // Infer fields from first doc
        if (docs.length > 0) {
          const keys = Object.keys(docs[0])
          setFields(keys.filter(key => key !== 'id'))
        } else {
          setFields([])
        }
      } catch (err) {
        message.error('Failed to fetch documents')
      } finally {
        setLoading(false)
      }
    }
    fetchDocuments()
  }, [selectedCollection, searchField, searchValue])

  const columns = fields.map(f => ({ title: f, dataIndex: f, key: f }))

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme='light' width={250} style={{ padding: 16 }}>
        <Title level={4}>Collections</Title>
        <Menu
          mode='inline'
          selectedKeys={[selectedCollection || '']}
          onClick={e => {
            setSelectedCollection(e.key)
            setSearchField('')
            setSearchValue('')
          }}
        >
          {collections.map(name => (
            <Menu.Item key={name}>{name}</Menu.Item>
          ))}
        </Menu>
      </Sider>
      <Layout>
        <Content style={{ padding: 24 }}>
          {selectedCollection ? (
            <>
              <Title level={3}>{selectedCollection}</Title>
              {fields.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <Select
                    placeholder='Search field'
                    style={{ width: 160, marginRight: 8 }}
                    value={searchField || undefined}
                    onChange={value => setSearchField(value)}
                    allowClear
                  >
                    {fields.map(f => (
                      <Option key={f} value={f}>
                        {f}
                      </Option>
                    ))}
                  </Select>
                  <Input.Search
                    placeholder='Search value'
                    allowClear
                    enterButton='Search'
                    style={{ width: 240 }}
                    onSearch={val => setSearchValue(val)}
                  />
                </div>
              )}
              <Card>
                {loading ? (
                  <Spin />
                ) : documents.length > 0 ? (
                  <Table
                    dataSource={documents.map(doc => ({ key: doc.id, ...doc }))}
                    columns={[
                      { title: 'ID', dataIndex: 'id', key: 'id' },
                      ...columns
                    ]}
                    scroll={{ x: 'max-content' }}
                  />
                ) : (
                  <Empty description='No documents found' />
                )}
              </Card>
            </>
          ) : (
            <Empty description='Select a collection from the sidebar' />
          )}
        </Content>
      </Layout>
    </Layout>
  )
}

export default FirestoreAdminPanel
