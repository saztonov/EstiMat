import { create } from 'zustand';
import type { User } from '@estimat/shared';
import { api } from '../services/api';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  accessTokenExpiresAt: number | null;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string, phone?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  setExpiresAt: (expiresAt: number) => void;
  clearError: () => void;
}

interface AuthResponse {
  user: User;
  accessTokenExpiresAt: number;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  accessTokenExpiresAt: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.post<AuthResponse>('/auth/login', { email, password });
      set({
        user: data.user,
        isAuthenticated: true,
        isLoading: false,
        accessTokenExpiresAt: data.accessTokenExpiresAt,
      });
    } catch (err) {
      set({ isLoading: false, error: (err as Error).message });
      throw err;
    }
  },

  register: async (email, password, fullName, phone) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.post<AuthResponse>('/auth/register', { email, password, fullName, phone });
      set({
        user: data.user,
        isAuthenticated: true,
        isLoading: false,
        accessTokenExpiresAt: data.accessTokenExpiresAt,
      });
    } catch (err) {
      set({ isLoading: false, error: (err as Error).message });
      throw err;
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch { /* best effort */ }
    set({ user: null, isAuthenticated: false, accessTokenExpiresAt: null });
  },

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const data = await api.get<{ user: User }>('/auth/me', { skipAuthRedirect: true });
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  setExpiresAt: (expiresAt) => set({ accessTokenExpiresAt: expiresAt }),
  clearError: () => set({ error: null }),
}));
