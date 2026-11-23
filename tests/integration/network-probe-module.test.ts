import { describe, expect, it, vi } from 'vitest';
import { createNetworkBroker } from '../../core/network/network-broker';
import { createSendPolicyStore } from '../../core/network/send-policy';
import { createPermissionService } from '../../core/permissions/permission-service';
import { MemoryArea } from '../../core/storage/browser-storage';
import { PersistenceGuard } from '../../core/storage/persistence-guard';
import { validateManifest } from '../../core/module-sdk/validate-manifest';
import probeManifest from '../fixtures/modules/network-probe/module.json';

describe('network-probe fixture', () => {
  it('never enters the production generated registry', async () => {
    const { moduleManifests } = await import('../../generated/module-manifest');
    expect(JSON.stringify(moduleManifests)).not.toContain('network-probe');
  });

  it('requests on first action, skips fetch on rejection, and scopes always-allow', async () => {
    const manifest = validateManifest(probeManifest);
    const requestPermission = vi.fn(() => Promise.resolve(true));
    const permissions = createPermissionService({
      declared: { [manifest.id]: manifest.permissions },
      api: {
        contains: () => Promise.resolve(false),
        request: requestPermission,
        remove: () => Promise.resolve(true),
      },
    });
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
    const confirm = vi.fn()
      .mockResolvedValueOnce('deny')
      .mockResolvedValueOnce('always')
      .mockResolvedValueOnce('once');
    const broker = createNetworkBroker({
      fetchImpl,
      confirm,
      policies: createSendPolicyStore(new MemoryArea(), new PersistenceGuard(false)),
      declaredOrigins: { [manifest.id]: manifest.permissions.optionalHostPermissions },
      hasPermission: async (intent) =>
        permissions.request({
          moduleId: intent.moduleId,
          permissions: [],
          origins: [intent.permission],
        }),
    });
    const intent = {
      moduleId: manifest.id,
      origin: 'https://api.example.com',
      dataCategory: 'lookup',
      byteCount: 4,
      method: 'GET',
      timeoutMs: 1_000,
      redactedPreview: 'id=***',
      permission: 'https://api.example.com/*',
    };
    await expect(broker.request(intent)).rejects.toMatchObject({ code: 'NETWORK_DENIED' });
    expect(fetchImpl).not.toHaveBeenCalled();
    await broker.request(intent);
    await broker.request(intent);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestPermission).toHaveBeenCalled();
  });
});
