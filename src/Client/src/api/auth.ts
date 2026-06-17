import { api } from './client';
import type { AuthToken, User } from '../types';
import { getOrCreateDeviceId } from '../utils/deviceId';

export const authApi = {
  // deviceId lets the server map this computer to a fixed room and return it on login.
  login: (username: string, password: string) =>
    api.post<AuthToken>('/auth/login', { username, password, deviceId: getOrCreateDeviceId() }),

  me: () => api.get<User>('/auth/me'),
};
