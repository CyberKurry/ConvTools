import { describe, expect, it, vi } from 'vitest';
import { createPermissionService } from '../../../core/permissions/permission-service';
import { MemoryArea } from '../../../core/storage/browser-storage';
import { PersistenceGuard } from '../../../core/storage/persistence-guard';

function declared() {
  return {
    'alpha-tool': {
      optionalPermissions: ['notifications'],
      optionalHostPermissions: ['https://api.example.com/*'],
    },
    'zeta-tool': {
      optionalPermissions: ['notifications'],
      optionalHostPermissions: [],
    },
  };
}

describe('permission service', () => {
  it('requests a declared permission on first use and isolates a denial', async () => {
    const request = vi.fn(() => Promise.resolve(false));
    const service = createPermissionService({
      declared: declared(),
      api: {
        contains: () => Promise.resolve(false),
        request,
        remove: () => Promise.resolve(true),
      },
    });
    await expect(
      service.request({
        moduleId: 'alpha-tool',
        permissions: ['notifications'],
        origins: ['https://api.example.com/*'],
      }),
    ).resolves.toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    await expect(
      service.request({
        moduleId: 'zeta-tool',
        permissions: ['notifications'],
        origins: [],
      }),
    ).resolves.toBe(false);
  });

  it('rejects undeclared origins and permissions before calling the browser API', async () => {
    const request = vi.fn(() => Promise.resolve(true));
    const service = createPermissionService({
      declared: declared(),
      api: {
        contains: () => Promise.resolve(false),
        request,
        remove: () => Promise.resolve(true),
      },
    });
    await expect(
      service.request({
        moduleId: 'alpha-tool',
        permissions: ['tabs'],
        origins: [],
      }),
    ).rejects.toMatchObject({ code: 'UNDECLARED_PERMISSION' });
    await expect(
      service.request({
        moduleId: 'alpha-tool',
        permissions: [],
        origins: ['https://evil.example.com/*'],
      }),
    ).rejects.toMatchObject({ code: 'UNDECLARED_ORIGIN' });
    expect(request).not.toHaveBeenCalled();
  });

  it('revokes a permission only when the last enabled claimant releases it', async () => {
    const remove = vi.fn(() => Promise.resolve(true));
    const service = createPermissionService({
      declared: declared(),
      api: {
        contains: () => Promise.resolve(true),
        request: () => Promise.resolve(true),
        remove,
      },
    });
    await service.request({ moduleId: 'alpha-tool', permissions: ['notifications'], origins: [] });
    await service.request({ moduleId: 'zeta-tool', permissions: ['notifications'], origins: [] });
    await service.releaseModule('alpha-tool');
    expect(remove).not.toHaveBeenCalled();
    await service.releaseModule('zeta-tool');
    expect(remove).toHaveBeenCalledWith({ permissions: ['notifications'] });
  });

  it('shares reference counts across contexts through storage (H2)', async () => {
    // popup/workbench/options each build their own kernel: the options page's
    // "revoke" must still see the claim made by the popup's context.
    const area = new MemoryArea();
    const guard = new PersistenceGuard(false);
    const remove = vi.fn(() => Promise.resolve(true));
    const api = {
      contains: () => Promise.resolve(true),
      request: () => Promise.resolve(true),
      remove,
    };
    const popup = createPermissionService({ declared: declared(), api, claims: { area, guard } });
    const options = createPermissionService({ declared: declared(), api, claims: { area, guard } });

    await popup.request({
      moduleId: 'alpha-tool',
      permissions: ['notifications'],
      origins: ['https://api.example.com/*'],
    });
    await options.releaseModule('alpha-tool');
    expect(remove).toHaveBeenCalledWith({ permissions: ['notifications'] });
    expect(remove).toHaveBeenCalledWith({ origins: ['https://api.example.com/*'] });
  });

  it('treats a repeated claim as idempotent and ignores release without a claim', async () => {
    const remove = vi.fn(() => Promise.resolve(true));
    const service = createPermissionService({
      declared: declared(),
      api: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true), remove },
      claims: { area: new MemoryArea(), guard: new PersistenceGuard(false) },
    });
    await service.request({ moduleId: 'alpha-tool', permissions: ['notifications'], origins: [] });
    await service.request({ moduleId: 'alpha-tool', permissions: ['notifications'], origins: [] });
    await service.releaseModule('alpha-tool');
    expect(remove).toHaveBeenCalledTimes(1);
    remove.mockClear();
    await service.releaseModule('alpha-tool');
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps a shared permission until the last holder releases it across contexts (H2)', async () => {
    const area = new MemoryArea();
    const guard = new PersistenceGuard(false);
    const remove = vi.fn(() => Promise.resolve(true));
    const api = { contains: () => Promise.resolve(true), request: () => Promise.resolve(true), remove };
    const one = createPermissionService({ declared: declared(), api, claims: { area, guard } });
    const two = createPermissionService({ declared: declared(), api, claims: { area, guard } });
    await one.request({ moduleId: 'alpha-tool', permissions: ['notifications'], origins: [] });
    await one.request({ moduleId: 'zeta-tool', permissions: ['notifications'], origins: [] });
    await two.releaseModule('alpha-tool');
    expect(remove).not.toHaveBeenCalled();
    await two.releaseModule('zeta-tool');
    expect(remove).toHaveBeenCalledWith({ permissions: ['notifications'] });
  });
});
