import { api } from './client';
import type { User, UserRole } from '../types';

export interface CreateUserPayload {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
  role: UserRole;
  identityNumber?: string;
  gender?: string;
  dateOfBirth?: string;
  phone?: string;
  mobile?: string;
  primaryJobTitle?: string;
  secondaryJobTitle?: string;
  department?: string;
  address?: string;
  city?: string;
  zipCode?: string;
  country?: string;
  notes?: string;
  accountExpiresAt?: string;
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
