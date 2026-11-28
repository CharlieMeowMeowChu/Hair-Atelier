type Readiness = 'preparing' | 'ready' | 'unavailable';

/** Show the current page's verified production shell, never merely registration. */
export function monitorOfflineStatus(element: HTMLElement): void {
  let registration: ServiceWorkerRegistration | undefined;
  let readiness: Readiness = 'preparing';
  let queryGeneration = 0;
  const observedWorkers = new WeakSet<ServiceWorker>();

  function paint(): void {
    const waiting = Boolean(registration?.waiting);
    if (readiness === 'ready' && waiting) {
      element.dataset.state = 'waiting';
      element.textContent = '離線程式已備妥；先儲存髮型，再關閉所有遊戲分頁啟用更新';
    } else {
      element.dataset.state = readiness;
      element.textContent = readiness === 'ready' ? '離線程式已備妥'
        : readiness === 'preparing' ? '正在準備離線程式…'
          : '離線狀態未確認';
    }
  }

  if (!('serviceWorker' in navigator) || !window.isSecureContext || typeof MessageChannel === 'undefined') {
    readiness = 'unavailable';
    paint();
    return;
  }
  const workers = navigator.serviceWorker;

  async function refresh(): Promise<void> {
    const generation = ++queryGeneration;
    const controller = workers.controller;
    if (!controller) {
      const installing = registration?.installing;
      readiness = installing && installing.state !== 'redundant' ? 'preparing' : 'unavailable';
      paint();
      return;
    }
    readiness = 'preparing';
    paint();
    const complete = await new Promise<boolean>((resolve) => {
      let channel: MessageChannel;
      try { channel = new MessageChannel(); }
      catch { resolve(false); return; }
      let settled = false;
      const finish = (result: boolean): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        channel.port1.close();
        resolve(result);
      };
      const timeout = window.setTimeout(() => finish(false), 3000);
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        const response = event.data as { type?: unknown; ready?: unknown } | null;
        finish(response?.type === 'HAIR_OFFLINE_STATUS' && response.ready === true);
      };
      channel.port1.onmessageerror = () => finish(false);
      try { controller.postMessage({ type: 'HAIR_OFFLINE_STATUS_REQUEST' }, [channel.port2]); }
      catch { finish(false); }
    });
    if (generation !== queryGeneration || workers.controller !== controller) return;
    readiness = complete ? 'ready' : 'unavailable';
    paint();
  }

  function observe(worker: ServiceWorker | null): void {
    if (!worker || observedWorkers.has(worker)) return;
    observedWorkers.add(worker);
    worker.addEventListener('statechange', () => { void refresh(); });
  }

  function attachRegistration(result: ServiceWorkerRegistration): void {
    if (registration !== result) {
      registration = result;
      registration.addEventListener('updatefound', () => { observe(registration?.installing ?? null); void refresh(); });
    }
    observe(registration.installing);
    observe(registration.waiting);
    void refresh();
  }

  function registrationFailed(): void {
    // A failed update check does not invalidate an existing controller's cache.
    // Verify it independently, and recover the waiting-worker status if available.
    void refresh();
    try {
      void workers.getRegistration().then((result) => {
        if (result) attachRegistration(result);
      }).catch(() => undefined);
    } catch { /* The current controller can still be checked without a registration. */ }
  }

  workers.addEventListener('controllerchange', () => { void refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window.addEventListener('online', () => { void refresh(); });
  window.addEventListener('offline', () => { void refresh(); });
  window.addEventListener('pageshow', () => { void refresh(); });
  paint();
  if (workers.controller) void refresh();
  try {
    void workers.register('./sw.js').then(attachRegistration).catch(registrationFailed);
  } catch { registrationFailed(); }
}
