import { api } from './client';
import type { AuthToken, User } from '../types';

export const authApi = {
  login: (username: string, password: string) =>
    api.post<AuthToken>('/auth/login', { username, password }),

  me: () => api.get<User>('/auth/me'),
};
