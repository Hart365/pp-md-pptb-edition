import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyToClipboard,
  getSetting,
  onToolboxEvent,
  saveSetting,
} from './toolboxAPI';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('ToolBox event bridge', () => {
  it('multiplexes subscribers and detaches the host listener after the last unsubscribe', () => {
    type HostEventListener = (event: unknown, payload: ToolBoxAPI.ToolBoxEventPayload) => void;
    let hostListener: HostEventListener | undefined;
    const events = {
      on: vi.fn((callback: HostEventListener) => {
        hostListener = callback;
      }),
      off: vi.fn(),
    };
    vi.stubGlobal('window', { toolboxAPI: { events } });

    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = onToolboxEvent(first);
    const unsubscribeSecond = onToolboxEvent(second);

    expect(events.on).toHaveBeenCalledTimes(1);
    expect(hostListener).toBeDefined();

    const payload: ToolBoxAPI.ToolBoxEventPayload = {
      event: 'settings:updated',
      data: { key: 'theme' },
      timestamp: '2026-10-22T00:00:00.000Z',
    };
    hostListener?.('settings:updated', payload);

    expect(first).toHaveBeenCalledWith('settings:updated', payload);
    expect(second).toHaveBeenCalledWith('settings:updated', payload);

    unsubscribeFirst?.();
    unsubscribeFirst?.();
    expect(events.off).not.toHaveBeenCalled();

    unsubscribeSecond?.();
    expect(events.off).toHaveBeenCalledTimes(1);
    expect(events.off).toHaveBeenCalledWith(hostListener);
  });
});

describe('ToolBox settings', () => {
  it('uses the same application namespace for host settings reads and writes', async () => {
    const settings = {
      get: vi.fn().mockResolvedValue(['saved']),
      set: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('window', { toolboxAPI: { settings } });

    await expect(getSetting('doc-configurations')).resolves.toEqual(['saved']);
    await saveSetting('pp-md-pptb-edition-doc-configurations', ['saved']);

    expect(settings.get).toHaveBeenCalledWith('pp-md-pptb-edition-doc-configurations');
    expect(settings.set).toHaveBeenCalledWith('pp-md-pptb-edition-doc-configurations', ['saved']);
  });

  describe('ToolBox clipboard', () => {
    it('routes copy operations through the host clipboard API', async () => {
      const copy = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('window', { toolboxAPI: { utils: { copyToClipboard: copy } } });

      await copyToClipboard('# documentation');

      expect(copy).toHaveBeenCalledWith('# documentation');
    });
  });

  it('uses localStorage for settings only in local development', async () => {
    const store = new Map<string, string>();
    const localStorageMock = {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    };
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', localStorageMock);

    vi.stubEnv('DEV', true);
    await saveSetting('doc-configurations', ['local']);
    await expect(getSetting('doc-configurations')).resolves.toEqual(['local']);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'pp-md-pptb-edition-doc-configurations',
      '["local"]',
    );

    vi.stubEnv('DEV', false);
    await saveSetting('doc-configurations', ['ignored']);
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
  });
});
