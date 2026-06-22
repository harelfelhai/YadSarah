import { api } from './client';

// Department-routing result. The routing ALWAYS commits to exactly one department, so
// `departments` holds a single item; `source` says how it was decided ('rule' = deterministic
// policy, 'ai' = LLM, 'fallback' = AI unavailable). Reception never picks — the field is read-only.
export interface RouteDepartmentResult {
  departments: string[];
  confidence: number;
  source: 'rule' | 'ai' | 'fallback' | string;
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
