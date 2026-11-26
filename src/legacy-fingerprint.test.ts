import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  legacyLocalStorageKeys, legacySnapshotMatches, makeLegacyGuard, snapshotLegacyLocalStorage,
  type LegacyLocalSnapshot,
} from './indexeddb-storage';

afterEach(() => { vi.unstubAllGlobals(); });

describe('legacy local-storage source markers', () => {
  it('preserves null, empty strings and Unicode exactly without crypto.subtle', async () => {
    vi.stubGlobal('crypto', {});
    const snapshot: LegacyLocalSnapshot = [null, '', '髮型🎨\u0000\n'];
    const guard = await makeLegacyGuard(snapshot, false);
    expect(guard.digest).toBe(`raw:${JSON.stringify(snapshot)}`);
    expect(JSON.parse(guard.digest.slice(4))).toEqual(snapshot);
    expect(guard.snapshot).toEqual(snapshot);
    expect(guard.snapshot).not.toBe(snapshot);
    expect(guard.persisted).toBe(false);
    const swapped = await makeLegacyGuard(['', null, snapshot[2]], false);
    expect(swapped.digest).not.toBe(guard.digest);
  });

  it('falls back to the exact snapshot when SHA-256 rejects', async () => {
    const digest = vi.fn().mockRejectedValue(new Error('digest unavailable'));
    vi.stubGlobal('crypto', { subtle: { digest } });
    const snapshot: LegacyLocalSnapshot = ['中文', null, ''];
    const guard = await makeLegacyGuard(snapshot, true);
    expect(digest).toHaveBeenCalledTimes(1);
    expect(guard.digest).toBe(`raw:${JSON.stringify(snapshot)}`);
    expect(guard.persisted).toBe(true);
  });

  it('never treats an unavailable requested SHA-256 marker as a raw match', async () => {
    vi.stubGlobal('crypto', {});
    await expect(makeLegacyGuard([null, '', '字'], true, 'sha256')).rejects.toThrow('SHA-256 is unavailable');
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockRejectedValue(new Error('digest rejected')) } });
    await expect(makeLegacyGuard([null, '', '字'], true, 'sha256')).rejects.toThrow('digest rejected');
  });

  it('compares a persisted raw marker in raw format even if SHA-256 later becomes available', async () => {
    const snapshot: LegacyLocalSnapshot = [null, '', '髮型🧑🏻‍🦱'];
    vi.stubGlobal('crypto', undefined);
    const old = await makeLegacyGuard(snapshot, false);
    const digest = vi.fn().mockResolvedValue(new Uint8Array(32).buffer);
    vi.stubGlobal('crypto', { subtle: { digest } });
    const reloaded = await makeLegacyGuard(snapshot, true, 'raw');
    expect(reloaded.digest).toBe(old.digest);
    expect(reloaded.persisted).toBe(true);
    expect(digest).not.toHaveBeenCalled();
    const changed = await makeLegacyGuard([null, '', '髮型🧑🏻‍🦰'], true, 'raw');
    expect(changed.digest).not.toBe(old.digest);
  });

  it('uses SHA-256 of the full JSON snapshot when available', async () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    const digest = vi.fn().mockResolvedValue(bytes.buffer);
    vi.stubGlobal('crypto', { subtle: { digest } });
    const snapshot: LegacyLocalSnapshot = ['a', null, '髮'];
    const guard = await makeLegacyGuard(snapshot, false);
    expect(guard.digest).toBe(`sha256-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`);
    expect(digest).toHaveBeenCalledOnce();
    expect(digest.mock.calls[0][0]).toBe('SHA-256');
    expect(new TextDecoder().decode(digest.mock.calls[0][1])).toBe(JSON.stringify(snapshot));
  });

  it('detects changed or inaccessible legacy keys without treating missing and empty as equal', async () => {
    const values = new Map<string, string>([[legacyLocalStorageKeys[1], '']]);
    const getItem = vi.fn((key: string) => values.get(key) ?? null);
    vi.stubGlobal('localStorage', { getItem });
    vi.stubGlobal('crypto', {});
    const guard = await makeLegacyGuard(snapshotLegacyLocalStorage(), false);
    expect(guard.snapshot).toEqual([null, '', null]);
    expect(legacySnapshotMatches(guard)).toBe(true);
    values.delete(legacyLocalStorageKeys[1]);
    expect(legacySnapshotMatches(guard)).toBe(false);
    getItem.mockImplementation(() => { throw new Error('storage unavailable'); });
    expect(legacySnapshotMatches(guard)).toBe(false);
  });
});
