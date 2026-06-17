import { api } from './client';
import type { ShiftStatusResult } from '../types';

export const shiftStatusApi = {
  get: () => api.get<ShiftStatusResult>('/shift-status'),
};
