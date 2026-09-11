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
