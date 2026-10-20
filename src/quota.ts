export class Quota {
  private limit: number;
  private warnThreshold: number;
  private now: () => Date;
  private day: string;
  private count: number;

  constructor(limit: number, warnThreshold: number, now?: () => Date) {
    this.limit = limit;
    this.warnThreshold = warnThreshold;
    this.now = now ?? (() => new Date());
    this.day = this.now().toISOString().slice(0, 10);
    this.count = 0;
  }

  get used(): number {
    return this.count;
  }

  consume(): number {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
    this.count += 1;
    return this.count;
  }

  warning(): string | undefined {
    if (this.limit <= 0) return undefined;
    if (this.count / this.limit >= this.warnThreshold) {
      return `Nach eigener Zählung: ${this.count}/${this.limit} Aufrufe heute verbraucht.`;
    }
    return undefined;
  }

  reset(): void {
    this.count = 0;
    this.day = this.now().toISOString().slice(0, 10);
  }
}