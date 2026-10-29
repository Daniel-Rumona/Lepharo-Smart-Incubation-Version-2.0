// internal: branch inventory only, never booked
// external: SMEs can request and be allocated it
export type ResourceVisibility = 'internal' | 'external'

export const isBookableResource = (resource: {
  visibility?: ResourceVisibility | string
}) => resource.visibility !== 'internal'

export interface ResourceItem {
    id: string;
    name: string;
    type: string;
    capacity: number;
    available: number;
    status: string;
    allocations: Allocation[];
    description: string;
    location?: string;
    maintainer?: string;
    branchId?: string | null;
    // Size of a single-unit resource, e.g. seats in a vehicle or boardroom
    seats?: number | null;
    // Missing on resources created before visibility existed; treated as external
    visibility?: ResourceVisibility;
  }

  export interface Allocation {
    id: string;
    resourceId: string;
    allocatedTo: string;
    purpose: string;
    startTime: any;
    endTime: any;
    quantity: number;
    status: string;
  }

  export interface ResourceRequest {
    id: string;
    resourceId: string;
    resourceName: string;
    requestedBy: string;
    quantity: number;
    durationDays: number;
    purpose: string;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: any;
  }
