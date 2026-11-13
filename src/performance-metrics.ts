export function percentile(samples: readonly number[], ratio: number): number | undefined {
  if (samples.length === 0 || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) return undefined;
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

export class RecentMeasurements {
  private readonly samples: number[] = [];

  public constructor(private readonly capacity = 120) {}

  public add(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.samples.push(milliseconds);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  public get p95(): number | undefined { return percentile(this.samples, 0.95); }
}
