/** Serializes snapshots so a slower older write cannot replace a newer one. */
export class SaveQueue {
  private pending: Promise<void> = Promise.resolve();
  public revision = 0;

  public save(snapshot: string, write: (snapshot: string) => Promise<void>): Promise<boolean> {
    this.revision += 1;
    const result = this.pending.then(() => write(snapshot)).then(() => true, () => false);
    this.pending = result.then(() => undefined);
    return result;
  }

  public async settled(): Promise<void> { await this.pending; }
}
