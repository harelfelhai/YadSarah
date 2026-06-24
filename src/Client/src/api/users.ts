import { api } from './client';
import type { User, UserRole } from '../types';

export interface CreateUserPayload {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
  roles: UserRole[];
  displayName?: string;
  identityNumber?: string;
  gender?: string;
  title?: string;
  licenseNumber?: string;
  specialistLicenseNumber?: string;
  employeeNumber?: string;
  mobile?: string;
  email?: string;
  department?: string;
  station?: string;
}

export interface UpdateUserPayload extends Omit<CreateUserPayload, 'password'> {
  newPassword?: string;
  isActive: boolean;
}

export const usersApi = {
  getAll: () => api.get<User[]>('/users'),
  getById: (id: string) => api.get<User>(`/users/${id}`),
  create: (payload: CreateUserPayload) => api.post<User>('/users', payload),
  update: (id: string, payload: UpdateUserPayload) => api.put<User>(`/users/${id}`, payload),
  resetFailures: (id: string) => api.post<void>(`/users/${id}/reset-failures`, {}),
};
