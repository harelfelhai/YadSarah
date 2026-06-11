import { api } from './client';
import type { Patient, PatientCreate } from '../types';

export const patientsApi = {
  search: (query: string) =>
    api.get<Patient[]>(`/patients/search?q=${encodeURIComponent(query)}`),

  getById: (id: string) => api.get<Patient>(`/patients/${id}`),

  create: (data: PatientCreate) => api.post<Patient>('/patients', data),

  update: (id: string, data: Partial<PatientCreate>) =>
    api.put<Patient>(`/patients/${id}`, data),
};
