import { api } from './client';

// Public (no-login) reference lookups for the intake/reception address fields.
// Non-PHI; safe to call without auth (used by the public page and the staffed screen alike).
export const referenceApi = {
  // City-scoped street autocomplete from the internal Streets catalog.
  streets: (city: string, q: string) =>
    api.get<string[]>(`/public-ref/streets?city=${encodeURIComponent(city)}&q=${encodeURIComponent(q)}`),

  // City names ordered by how often patients register from each (most-used first).
  frequentCities: () => api.get<string[]>('/public-ref/cities/frequent'),
};
