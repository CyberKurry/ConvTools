export interface PermissionRequest {
  readonly moduleId: string;
  readonly permissions: readonly string[];
  readonly origins: readonly string[];
}

export interface DeclaredCapabilities {
  readonly optionalPermissions: readonly string[];
  readonly optionalHostPermissions: readonly string[];
}

export interface BrowserPermissionsApi {
  contains(details: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
  request(details: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
  remove(details: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
}