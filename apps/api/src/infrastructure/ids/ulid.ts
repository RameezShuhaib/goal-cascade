import type { IIdGenerator } from '../../application/ports';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(ms: number): string {
  let s = '';
  for (let i = 0; i < 10; i++) {
    s = ENCODING[ms % 32] + s;
    ms = Math.floor(ms / 32);
  }
  return s;
}

/**
 * Monotonic ULID generator (SPEC Q-8, as ruled by the orchestrator: ULID rather than UUIDv7). Within one millisecond the random part is
 * incremented so ids generated in one request sort in creation order.
 */
export class UlidGenerator implements IIdGenerator {
  private lastMs = -1;
  private lastRandom: number[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  ulid(): string {
    const ms = this.now();
    if (ms === this.lastMs) {
      // increment the 80-bit random part (16 base32 chars) — carries over
      for (let i = 15; i >= 0; i--) {
        const v = (this.lastRandom[i] ?? 0) + 1;
        if (v < 32) {
          this.lastRandom[i] = v;
          break;
        }
        this.lastRandom[i] = 0;
      }
    } else {
      this.lastMs = ms;
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      this.lastRandom = Array.from(bytes, (b) => b % 32);
    }
    return encodeTime(ms) + this.lastRandom.map((r) => ENCODING[r]).join('');
  }
}
