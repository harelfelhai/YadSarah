export const DEPARTMENTS = ['רפואה דחופה', 'ילדים', 'נשים'] as const;

export type Department = (typeof DEPARTMENTS)[number];
