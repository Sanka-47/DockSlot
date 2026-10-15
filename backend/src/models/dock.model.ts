import { Dock, DockClosure, DockStatus } from '@prisma/client';

export type EffectiveDockStatus = 'ACTIVE' | 'MAINTENANCE';

export interface DockWithEffectiveStatus extends Dock {
  closures?: DockClosure[];
  effectiveStatus: EffectiveDockStatus;
}
