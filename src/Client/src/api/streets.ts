import { api } from './client';

export const streetsApi = {
  // City-scoped street autocomplete. Returns plain street names, served offline
  // from the internal catalog (synced from data.gov.il).
  search: (city: string, q: string, take = 20) =>
    api.get<string[]>(
      `/streets?city=${encodeURIComponent(city)}&q=${encodeURIComponent(q)}&take=${take}`,
    ),
};
