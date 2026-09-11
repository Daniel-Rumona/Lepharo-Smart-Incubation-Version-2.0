import type { IResourceItem } from '@refinedev/core'

import {
  DashboardOutlined,
  ProjectOutlined,
  ShopOutlined
} from '@ant-design/icons'

export const resources: IResourceItem[] = [ 
  {
    name: 'dashboard',
    list: '/',
    meta: {
      label: 'Dashboard',
      icon: <DashboardOutlined />
    }
  },
  {
    name: 'companies',
    list: '/companies',
    show: '/companies/:id',
    create: '/companies/new',
    edit: '/companies/edit/:id',
    meta: {
      label: 'Companiess',
      icon: <ProjectOutlined />
    }
  }
]
