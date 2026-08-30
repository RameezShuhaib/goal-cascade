import type { IClock } from '../application/ports';

export class SystemClock implements IClock {
  now(): Date {
    return new Date();
  }
  nowIso(): string {
    return new Date().toISOString();
  }
}
