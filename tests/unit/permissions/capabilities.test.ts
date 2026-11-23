import { describe, expect, it, vi } from 'vitest';
import { wireModuleCapabilities } from '../../../core/permissions/capabilities';
import { MemoryArea } from '../../../core/storage/browser-storage';
import { PersistenceGuard } from '../../../core/storage/persistence-guard';
import probeManifest from '../../fixtures/modules/network-probe/module.json';
import type { ToolModuleManifest } from '../../../core/module-sdk/manifest';

const manifest = probeManifest as unknown as ToolModuleManifest;

function makeApi(request = vi.fn(() => Promise.resolve(true))) {
  return {
    contains: vi.fn(() => Promise.resolve(false)),
    request,
    remove: vi.fn(() => Promise.resolve(true)),
  };
}

describe('module capability wiring (ultrareview batch 7)', () => {
  it('answers false for modules without declared capabilities instead of throwing', async () => {
    const api = makeApi();
    const capabilities = wireModuleCapabilities({
      manifests: {},
      permissionsApi: api,
      policyArea: new MemoryArea(),
      guard: new PersistenceGuard(false),
    });
    await expect(capabilities.request('ghost-tool', ['notifications'], [])).resolves.toBe(false);
    await expect(capabilities.contains('ghost-tool', ['notifications'], [])).resolves.toBe(false);
    expect(api.request).not.toHaveBeenCalled();
  });

  it('routes declared permission requests through the browser permissions API', async () => {
    const api = makeApi();
    const capabilities = wireModuleCapabilities({
      manifests: { [manifest.id]: manifest.permissions },
      permissionsApi: api,
      policyArea: new MemoryArea(),
      guard: new PersistenceGuard(false),
    });
    await expect(
      capabilities.request(manifest.id, [], ['https://api.example.com/*']),
    ).resolves.toBe(true);
    expect(api.request).toHaveBeenCalledWith({ permissions: [], origins: ['https://api.example.com/*'] });
    // Revocation only removes claims the module actually holds.
    await capabilities.revoke(manifest.id);
    expect(api.remove).toHaveBeenCalledWith({ origins: ['https://api.example.com/*'] });
  });

  it('returns no network transport for modules without declared host permissions', async () => {
    const capabilities = wireModuleCapabilities({
      manifests: {
        offline: { optionalPermissions: [], optionalHostPermissions: [] },
      },
      permissionsApi: makeApi(),
      fetchImpl: vi.fn(),
      policyArea: new MemoryArea(),
      guard: new PersistenceGuard(false),
    });
    await expect(
      capabilities.requestNetwork('offline', {
        moduleId: 'offline',
        origin: 'https://api.example.com',
        dataCategory: 'lookup',
        byteCount: 0,
        method: 'GET',
        timeoutMs: 1_000,
        redactedPreview: '',
        permission: 'https://api.example.com/*',
      }),
    ).resolves.toBeUndefined();
  });

  it('denies network requests when no confirmation UI is wired (safe default)', async () => {
    const fetchImpl = vi.fn();
    const capabilities = wireModuleCapabilities({
      manifests: { [manifest.id]: manifest.permissions },
      permissionsApi: makeApi(),
      fetchImpl: fetchImpl,
      policyArea: new MemoryArea(),
      guard: new PersistenceGuard(false),
    });
    // Denial disables only the network capability (spec §13.2): the proxy
    // resolves undefined so modules fall back to their offline behavior.
    await expect(
      capabilities.requestNetwork(manifest.id, {
        moduleId: manifest.id,
        origin: 'https://api.example.com',
        dataCategory: 'lookup',
        byteCount: 0,
        method: 'GET',
        timeoutMs: 1_000,
        redactedPreview: '',
        permission: 'https://api.example.com/*',
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends through the broker when the user confirms', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
    const confirmSend = vi.fn(() => Promise.resolve('once' as const));
    const capabilities = wireModuleCapabilities({
      manifests: { [manifest.id]: manifest.permissions },
      permissionsApi: makeApi(),
      fetchImpl: fetchImpl,
      confirmSend,
      policyArea: new MemoryArea(),
      guard: new PersistenceGuard(false),
    });
    await expect(
      capabilities.requestNetwork(manifest.id, {
        moduleId: manifest.id,
        origin: 'https://api.example.com',
        dataCategory: 'lookup',
        byteCount: 0,
        method: 'GET',
        timeoutMs: 1_000,
        redactedPreview: '',
        permission: 'https://api.example.com/*',
      }),
    ).resolves.toMatchObject({ ok: true, status: 200, body: 'ok' });
    expect(confirmSend).toHaveBeenCalledTimes(1);
  });

  it('rejects an intent whose module id does not match the scoped proxy', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('should not send')));
    const capabilities = wireModuleCapabilities({
      manifests: { [manifest.id]: manifest.permissions },
      permissionsApi: makeApi(),
      fetchImpl,
      confirmSend: () => Promise.resolve('once' as const),
      policyArea: new MemoryArea(),
      guard: new PersistenceGuard(false),
    });
    await expect(
      capabilities.requestNetwork(manifest.id, {
        moduleId: 'another-module',
        origin: 'https://api.example.com',
        dataCategory: 'lookup',
        byteCount: 0,
        method: 'GET',
        timeoutMs: 1_000,
        redactedPreview: '',
        permission: 'https://api.example.com/*',
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('propagates the module cancellation signal to the network broker', async () => {
    const fetchImpl = vi.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const capabilities = wireModuleCapabilities({
      manifests: { [manifest.id]: manifest.permissions },
      permissionsApi: makeApi(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      confirmSend: () => Promise.resolve('once' as const),
      policyArea: new MemoryArea(),
      guard: new PersistenceGuard(false),
    });
    const controller = new AbortController();
    const pending = capabilities.requestNetwork(
      manifest.id,
      {
        moduleId: manifest.id,
        origin: 'https://api.example.com',
        dataCategory: 'lookup',
        byteCount: 0,
        method: 'GET',
        timeoutMs: 60_000,
        redactedPreview: '',
        permission: 'https://api.example.com/*',
      },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'NETWORK_CANCELLED' });
  });
});
