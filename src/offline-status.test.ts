import { afterEach, describe, expect, it, vi } from 'vitest';
import { monitorOfflineStatus } from './offline-status';

class MockPort {
  peer!: MockPort;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  close(): void { /* no resources in the test double */ }
  postMessage(data: unknown): void {
    queueMicrotask(() => this.peer.onmessage?.({ data }));
  }
}

class MockChannel {
  port1 = new MockPort();
  port2 = new MockPort();
  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

function setup(options: { controller: boolean; reply: boolean; syncThrow?: boolean; waiting?: boolean; deferReply?: boolean; lookupReject?: boolean }) {
  let rejectRegistration!: (reason?: unknown) => void;
  const pendingRegistration = new Promise<ServiceWorkerRegistration>((_, reject) => { rejectRegistration = reject; });
  const waiting = options.waiting ? Object.assign(new EventTarget(), { state: 'installed' }) : null;
  const registration = options.waiting ? Object.assign(new EventTarget(), { waiting, installing: null }) : undefined;
  let savedPort: MockPort | undefined;
  let readyAnswer = true;
  let queries = 0;
  const controller = options.controller ? {
    postMessage: (_message: unknown, ports: MockPort[]) => {
      queries += 1;
      if (options.deferReply) savedPort = ports[0];
      else if (options.reply) ports[0].postMessage({ type: 'HAIR_OFFLINE_STATUS', ready: readyAnswer });
    },
  } : null;
  const workers = Object.assign(new EventTarget(), {
    controller: controller as typeof controller,
    register: () => { if (options.syncThrow) throw new Error('synchronous failure'); return pendingRegistration; },
    getRegistration: async () => { if (options.lookupReject) throw new Error('lookup failed'); return registration; },
  });
  const fakeWindow = Object.assign(new EventTarget(), {
    isSecureContext: true,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('navigator', { serviceWorker: workers });
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('MessageChannel', MockChannel);
  const element = { dataset: {}, textContent: '' } as unknown as HTMLElement;
  monitorOfflineStatus(element);
  return {
    element, fakeWindow, rejectRegistration, workers,
    setReadyAnswer: (ready: boolean) => { readyAnswer = ready; },
    replyLate: () => savedPort?.postMessage({ type: 'HAIR_OFFLINE_STATUS', ready: true }),
    queryCount: () => queries,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('offline status when service worker registration fails', () => {
  it('rechecks and preserves a verified active controller after a delayed registration failure', async () => {
    const { element, fakeWindow, rejectRegistration } = setup({ controller: true, reply: true });
    fakeWindow.dispatchEvent(new Event('pageshow'));
    await vi.waitFor(() => expect(element.dataset.state).toBe('ready'), { timeout: 500 });

    rejectRegistration(new Error('registration failed while the existing worker remains active'));
    // Let the rejected registration handler and any replacement verification run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.waitFor(() => expect(element.dataset.state).toBe('ready'), { timeout: 500 });
  });

  it('shows unavailable when registration fails and there is no controller', async () => {
    const { element, rejectRegistration } = setup({ controller: false, reply: false });
    rejectRegistration(new Error('registration failed'));
    await vi.waitFor(() => expect(element.dataset.state).toBe('unavailable'), { timeout: 500 });
  });

  it('rechecks an existing controller after register throws synchronously', async () => {
    const { element } = setup({ controller: true, reply: true, syncThrow: true });
    await vi.waitFor(() => expect(element.dataset.state).toBe('ready'), { timeout: 500 });
  });

  it('recovers a waiting registration after register fails', async () => {
    const { element, fakeWindow, rejectRegistration } = setup({ controller: true, reply: true, waiting: true });
    fakeWindow.dispatchEvent(new Event('pageshow'));
    await vi.waitFor(() => expect(element.dataset.state).toBe('ready'), { timeout: 500 });
    rejectRegistration(new Error('registration failed'));
    await Promise.resolve(); await Promise.resolve();
    await vi.waitFor(() => expect(element.dataset.state).toBe('waiting'), { timeout: 500 });
  });

  it('verifies the active controller even if registration lookup also fails', async () => {
    const { element, rejectRegistration } = setup({ controller: true, reply: true, lookupReject: true });
    rejectRegistration(new Error('registration failed'));
    await vi.waitFor(() => expect(element.dataset.state).toBe('ready'), { timeout: 500 });
  });

  it('reports unavailable when the recheck finds that the cache is missing', async () => {
    const { element, fakeWindow, rejectRegistration, setReadyAnswer, queryCount } = setup({ controller: true, reply: true });
    fakeWindow.dispatchEvent(new Event('pageshow'));
    await vi.waitFor(() => expect(element.dataset.state).toBe('ready'), { timeout: 500 });
    setReadyAnswer(false);
    rejectRegistration(new Error('registration failed'));
    await vi.waitFor(() => expect(element.dataset.state).toBe('unavailable'), { timeout: 500 });
    expect(queryCount()).toBeGreaterThanOrEqual(2);
  });

  it('does not use a stale ready reply after the controller changes', async () => {
    const { element, fakeWindow, workers, replyLate } = setup({ controller: true, reply: true, deferReply: true });
    fakeWindow.dispatchEvent(new Event('pageshow'));
    workers.controller = null;
    workers.dispatchEvent(new Event('controllerchange'));
    replyLate();
    await Promise.resolve(); await Promise.resolve();
    expect(element.dataset.state).toBe('unavailable');
  });

  it('does not claim ready when an active controller does not answer', async () => {
    vi.useFakeTimers();
    const { element, fakeWindow, rejectRegistration } = setup({ controller: true, reply: false });
    fakeWindow.dispatchEvent(new Event('pageshow'));
    rejectRegistration(new Error('registration failed'));
    await vi.advanceTimersByTimeAsync(3100);
    expect(element.dataset.state).toBe('unavailable');
  });
});
