import { describe, expect, it } from 'vitest';
import { SaveQueue } from './save-queue';

describe('save queue', () => {
  it('writes snapshots in edit order even when the first write is delayed', async () => {
    const queue = new SaveQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const saved: string[] = [];
    const write = async (snapshot: string) => { if (snapshot === 'old') await gate; saved.push(snapshot); };
    const old = queue.save('old', write);
    const recent = queue.save('new', write);
    await Promise.resolve();
    expect(saved).toEqual([]);
    release();
    expect(await Promise.all([old, recent])).toEqual([true, true]);
    expect(saved).toEqual(['old', 'new']);
    expect(queue.revision).toBe(2);
  });
  it('continues saving after a write failure', async () => {
    const queue = new SaveQueue();
    const first = queue.save('bad', async () => { throw new Error('failed'); });
    const second = queue.save('good', async () => undefined);
    expect(await Promise.all([first, second])).toEqual([false, true]);
    await queue.settled();
  });
});
