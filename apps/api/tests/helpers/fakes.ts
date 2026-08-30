import type { IClock, IEmailSender, OutgoingEmail } from '../../src/application/ports';

/** Hand-rolled fakes (no mocking library). Mock only time, IO and randomness — never a repository. */
export class FakeClock implements IClock {
  private current: Date;
  constructor(iso = '2026-08-31T10:00:00.000Z') {
    this.current = new Date(iso);
  }
  now(): Date {
    return new Date(this.current);
  }
  nowIso(): string {
    return this.current.toISOString();
  }
  set(iso: string) {
    this.current = new Date(iso);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
  /** Convenience for week-boundary tests: `advance(7 * DAY)` reads badly at call sites. */
  advanceWeeks(n: number) {
    this.advance(n * 7 * 86_400_000);
  }
}

export class FakeEmailSender implements IEmailSender {
  readonly sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }
  lastTo(to: string): OutgoingEmail | undefined {
    return [...this.sent].reverse().find((e) => e.to.toLowerCase() === to.toLowerCase());
  }
}
