import { describe, expect, it } from 'vitest';
import { PermissionReferenceCounts } from '../../../core/permissions/reference-counts';

describe('permission reference counts', () => {
  it('revokes a shared permission only when the final claimant releases it', () => {
    const counts = new PermissionReferenceCounts();
    counts.claim('alpha-tool', 'notifications');
    counts.claim('zeta-tool', 'notifications');
    expect(counts.release('alpha-tool', 'notifications').remaining).toBe(1);
    expect(counts.releaseAll('zeta-tool')).toEqual(['notifications']);
    expect(counts.holders('notifications')).toEqual([]);
  });
});
