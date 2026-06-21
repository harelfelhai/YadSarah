import { api } from './client';

// AI department-routing result. `departments` holds one item when the AI is confident
// (assigned), or several candidates when confidence is low (reception picks one).
export interface RouteDepartmentResult {
  departments: string[];
  confidence: number;
  source: 'ai' | 'fallback' | string;
  assigned?: string | null;
  assignedByAi: boolean;
}

export interface RouteDepartmentParams {
  admissionReason?: string;
  age?: number;
  gender?: string;
}

export const receptionApi = {
  // Decide the department from the admission reason (+ optional age/gender context).
  routeDepartment: (params: RouteDepartmentParams) =>
    api.post<RouteDepartmentResult>('/reception/route-department', params),

  // Verify a shift-manager credential to unlock the discount/exemption field (UX gate).
  // The visit-create re-verifies, so this is not the only line of defense.
  authorizeDiscount: (username: string, password: string) =>
    api.post<{ approvedByName: string }>('/reception/authorize-discount', { username, password }),
};
