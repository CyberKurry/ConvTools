export interface PermissionClaim {
  readonly moduleId: string;
  readonly permission: string;
}

export class PermissionReferenceCounts {
  private readonly claims = new Map<string, Set<string>>();

  claim(moduleId: string, permission: string): void {
    const holders = this.claims.get(permission) ?? new Set<string>();
    holders.add(moduleId);
    this.claims.set(permission, holders);
  }

  release(moduleId: string, permission: string): { readonly remaining: number } {
    const holders = this.claims.get(permission);
    if (!holders) {
      return { remaining: 0 };
    }
    holders.delete(moduleId);
    if (holders.size === 0) {
      this.claims.delete(permission);
      return { remaining: 0 };
    }
    return { remaining: holders.size };
  }

  releaseAll(moduleId: string): readonly string[] {
    const revoked: string[] = [];
    for (const permission of [...this.claims.keys()]) {
      const { remaining } = this.release(moduleId, permission);
      if (remaining === 0) {
        revoked.push(permission);
      }
    }
    return revoked;
  }

  holders(permission: string): readonly string[] {
    return [...(this.claims.get(permission) ?? [])];
  }

  /** Serializable view for contexts that must share counts through storage. */
  snapshot(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [permission, holders] of this.claims) {
      out[permission] = [...holders];
    }
    return out;
  }
}