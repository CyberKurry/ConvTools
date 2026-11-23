export {};

declare global {
  function defineBackground(main: () => void): unknown;
  function defineUnlistedScript(main: () => void): unknown;

  interface ContextMenuInfo {
    menuItemId: string | number;
    selectionText?: string;
  }

  interface TabStub {
    id?: number;
  }

  interface StorageAreaStub {
    get(key?: string | string[] | null): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(key: string | string[]): Promise<void>;
    clear(): Promise<void>;
  }

  const browser: {
    runtime: {
      getURL(path: string): string;
      onInstalled: { addListener(listener: () => void): void };
      onStartup: { addListener(listener: () => void): void };
      onMessage: {
        addListener(listener: (message: unknown) => Promise<unknown> | boolean): void;
      };
      sendMessage(message: unknown): Promise<unknown>;
    };
    extension: {
      inIncognitoContext?: boolean;
    };
    storage: {
      sync: StorageAreaStub;
      session: StorageAreaStub;
      local: StorageAreaStub;
      onChanged: {
        addListener(listener: (changes: Record<string, unknown>, areaName: string) => void): void;
      };
    };
    permissions: {
      contains(details: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
      request(details: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
      remove(details: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
    };
    contextMenus: {
      removeAll(): Promise<void>;
      create(options: { id: string; title: string; contexts: string[] }): Promise<void>;
      onClicked: {
        addListener(listener: (info: ContextMenuInfo, tab?: TabStub) => void): void;
      };
    };
    tabs: {
      create(options: { url: string }): Promise<unknown>;
      query(options: { active?: boolean; currentWindow?: boolean }): Promise<TabStub[]>;
    };
    scripting: {
      executeScript(
        options:
          | { target: { tabId: number }; files: string[] }
          | { target: { tabId: number }; func: (...args: never[]) => void; args: unknown[] },
      ): Promise<unknown>;
    };
  };
}
