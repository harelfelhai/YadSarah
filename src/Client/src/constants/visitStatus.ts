import type { VisitStatus } from '../types';

// Hebrew labels + muted theme colors for a visit's status. Shared across the
// clinical queue and the discharge board so the two boards read identically.
export const STATUS_LABEL: Record<VisitStatus, string> = {
  Waiting: 'ממתין',
  Called: 'נקרא',
  InTreatment: 'בטיפול',
  FinishedTreatment: 'סיים טיפול',
  Discharged: 'שוחרר',
};

export const STATUS_COLOR: Record<VisitStatus, string> = {
  Waiting: 'steel',
  Called: 'ochre',
  InTreatment: 'moss',
  FinishedTreatment: 'pine',
  Discharged: 'slate',
};
