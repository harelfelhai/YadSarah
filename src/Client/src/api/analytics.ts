import { api } from './client';

export interface WeekdayPoint {
  weekday: number; // 0 = Sunday … 6 = Saturday
  avgPerDay: number;
  total: number;
}

export interface HalfHourPoint {
  bin: number; // 0 = 00:00 … 47 = 23:30
  label: string; // "HH:mm"
  avgPerDay: number;
  total: number;
}

export interface CensusPoint {
  bin: number;
  label: string;
  avg: number;
  max: number;
}

export interface AnalyticsOverview {
  from: string; // YYYY-MM-DD
  to: string;
  days: number;
  patientsByWeekday: WeekdayPoint[];
  arrivalsByHalfHour: HalfHourPoint[];
  censusByHalfHour: CensusPoint[];
}

export const analyticsApi = {
  overview: (from?: string, to?: string) => {
    const sp = new URLSearchParams();
    if (from) sp.set('from', from);
    if (to) sp.set('to', to);
    const qs = sp.toString();
    return api.get<AnalyticsOverview>(`/analytics/overview${qs ? `?${qs}` : ''}`);
  },
};
