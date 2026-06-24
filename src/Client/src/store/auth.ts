import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';

interface AuthState {
  token: string | null;
  user: User | null;
  // ISO expiry of the access token, stored so the client can proactively log out an
  // idle/expired session instead of waiting for the next API call to 401.
  expiresAt: string | null;
  setAuth: (token: string, user: User, expiresAt: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      expiresAt: null,
      setAuth: (token, user, expiresAt) => {
        localStorage.setItem('auth_token', token);
        set({ token, user, expiresAt });
      },
      clearAuth: () => {
        localStorage.removeItem('auth_token');
        set({ token: null, user: null, expiresAt: null });
      },
    }),
    { name: 'auth' }
  )
);
