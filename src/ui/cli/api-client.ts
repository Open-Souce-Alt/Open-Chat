import WebSocket from 'ws';
import { type VfsEntry, type ChatMessage } from '../../core/vfs/vfs.js';
import { type ServerEvent } from '../../server/events.js';
import { type AccountRow } from '../../core/db/schema.js';

export interface CatResult {
  chat: {
    id: string;
    title: string;
    chat_type: string;
    unread_count: number;
  };
  messages: ChatMessage[];
}

export type EventListener = (event: ServerEvent) => void;

interface ApiResponse {
  error?: string;
  cwd?: string;
  created?: string;
  removed?: string;
  pointerName?: string;
  entries?: VfsEntry[];
  accounts?: AccountRow[];
  accountId?: string;
  chat?: CatResult['chat'];
  messages?: ChatMessage[];
}

async function parseResponseJson(res: Response): Promise<ApiResponse> {
  // SAFETY: Server endpoints return verified JSON payloads conforming to ApiResponse
  return (await res.json()) as ApiResponse;
}

export class ApiClient {
  private baseUrl: string;
  private wsUrl: string;
  private currentPath: string = '/';
  private ws: WebSocket | null = null;
  private eventListeners: Set<EventListener> = new Set();
  private isConnected: boolean = false;

  constructor(serverUrl: string = 'http://127.0.0.1:3000') {
    // Strip trailing slashes
    this.baseUrl = serverUrl.replace(/\/+$/, '');
    const urlObj = new URL(this.baseUrl);
    const protocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';

    this.wsUrl = `${protocol}//${urlObj.host}/ws`;
  }

  public getCwd(): string {
    return this.currentPath;
  }

  public async init(): Promise<void> {
    // 1. Verify HTTP connectivity
    const health = await this.healthCheck();

    if (!health.ok) {
      throw new Error(`Cannot connect to Open Chat daemon at ${this.baseUrl}`);
    }

    // 2. Connect WebSocket for live events
    return new Promise<void>((resolve) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        this.isConnected = true;
        resolve();
      });

      this.ws.on('message', (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());

          for (const listener of this.eventListeners) {
            listener(parsed);
          }
        } catch {
          // ignore malformed payloads
        }
      });

      this.ws.on('error', () => {
        this.isConnected = false;
        resolve(); // resolve anyway so CLI doesn't block if WS has hiccup
      });

      this.ws.on('close', () => {
        this.isConnected = false;
      });
    });
  }

  public onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);

    return () => {
      this.eventListeners.delete(listener);
    };
  }

  public async healthCheck(): Promise<{ ok: boolean; data?: unknown }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`);

      if (!res.ok) {
        return { ok: false };
      }

      const data: unknown = await res.json();

      return { ok: true, data };
    } catch {
      return { ok: false };
    }
  }

  private resolvePathAgainstCwd(targetPath?: string): string {
    if (!targetPath) {
      return this.currentPath;
    }

    if (targetPath.startsWith('/')) {
      return targetPath;
    }

    const base = this.currentPath === '/' ? '' : this.currentPath;

    return `${base}/${targetPath}`;
  }

  public async cd(targetPath?: string): Promise<string> {
    const resolved = this.resolvePathAgainstCwd(targetPath ?? '/');

    const res = await fetch(`${this.baseUrl}/api/vfs/cd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: resolved }),
    });

    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || `Failed to cd to ${targetPath}`);
    }

    this.currentPath = String(json.cwd || '/');

    return this.currentPath;
  }

  public async ls(
    targetPath?: string,
    options: { all?: boolean | undefined; sort?: 'time' | 'name' | undefined; reverse?: boolean | undefined } = {}
  ): Promise<VfsEntry[]> {
    const resolved = this.resolvePathAgainstCwd(targetPath);
    const params = new URLSearchParams();

    if (resolved) {
      params.append('path', resolved);
    }

    if (options.all) {
      params.append('all', 'true');
    }

    if (options.sort) {
      params.append('sort', options.sort);
    }

    if (options.reverse) {
      params.append('reverse', 'true');
    }

    const res = await fetch(`${this.baseUrl}/api/vfs/ls?${params.toString()}`);
    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || 'Failed to list directory');
    }

    // SAFETY: Server /api/vfs/ls returns validated VfsEntry array
    return (json.entries || []) as VfsEntry[];
  }

  public async mkdir(targetPath: string, options: { recursive?: boolean } = {}): Promise<string> {
    const resolved = this.resolvePathAgainstCwd(targetPath);

    const res = await fetch(`${this.baseUrl}/api/vfs/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: resolved, recursive: options.recursive }),
    });

    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || `Failed to mkdir ${targetPath}`);
    }

    return String(json.created || targetPath);
  }

  public async rmdir(targetPath: string): Promise<string> {
    const resolved = this.resolvePathAgainstCwd(targetPath);

    const res = await fetch(`${this.baseUrl}/api/vfs/rmdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: resolved }),
    });

    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || `Failed to rmdir ${targetPath}`);
    }

    return String(json.removed || targetPath);
  }

  public async cat(targetPath: string, limit = 50): Promise<CatResult> {
    const resolved = this.resolvePathAgainstCwd(targetPath);
    const params = new URLSearchParams({ path: resolved, limit: String(limit) });
    const res = await fetch(`${this.baseUrl}/api/vfs/cat?${params.toString()}`);

    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || `Failed to read chat ${targetPath}`);
    }

    // SAFETY: Server /api/vfs/cat returns CatResult payload
    return {
      chat: json.chat as CatResult['chat'],
      messages: (json.messages || []) as ChatMessage[],
    };
  }

  public async ln(sourcePath: string, targetDir: string): Promise<string> {
    const resolvedSource = this.resolvePathAgainstCwd(sourcePath);
    const resolvedTarget = this.resolvePathAgainstCwd(targetDir);

    const res = await fetch(`${this.baseUrl}/api/vfs/ln`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: resolvedSource, targetDir: resolvedTarget }),
    });

    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || 'Failed to create link');
    }

    return String(json.pointerName || '');
  }

  public async rm(targetPath: string): Promise<string> {
    const resolved = this.resolvePathAgainstCwd(targetPath);

    const res = await fetch(`${this.baseUrl}/api/vfs/rm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: resolved }),
    });

    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || `Failed to remove ${targetPath}`);
    }

    return String(json.removed || targetPath);
  }

  public async mv(sourcePath: string, destPath: string): Promise<void> {
    const resolvedSource = this.resolvePathAgainstCwd(sourcePath);
    const resolvedDest = this.resolvePathAgainstCwd(destPath);

    const res = await fetch(`${this.baseUrl}/api/vfs/mv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: resolvedSource, destination: resolvedDest }),
    });

    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || `Failed to move ${sourcePath}`);
    }
  }

  public async cp(sourcePath: string, destPath: string, options: { recursive?: boolean } = {}): Promise<void> {
    const resolvedSource = this.resolvePathAgainstCwd(sourcePath);
    const resolvedDest = this.resolvePathAgainstCwd(destPath);

    const res = await fetch(`${this.baseUrl}/api/vfs/cp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: resolvedSource,
        destination: resolvedDest,
        recursive: options.recursive,
      }),
    });

    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || `Failed to copy ${sourcePath}`);
    }
  }

  public async connectAuth(
    platform: string,
    accountLabel?: string,
    mock?: boolean,
    clean?: boolean
  ): Promise<{ accountId: string }> {
    const res = await fetch(`${this.baseUrl}/api/auth/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, accountLabel, mock, clean }),
    });

    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || 'Failed to initiate platform connection');
    }

    return { accountId: String(json.accountId || '') };
  }

  public async submitChallengeResponse(accountId: string, response: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth/challenge-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, response }),
    });

    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || 'Failed to submit challenge response');
    }
  }

  public async listAccounts(): Promise<AccountRow[]> {
    const res = await fetch(`${this.baseUrl}/api/auth/accounts`);
    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || 'Failed to list accounts');
    }

    // SAFETY: Server /api/auth/accounts returns AccountRow array
    return (json.accounts || []) as AccountRow[];
  }

  public async disconnectAuth(accountId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/auth/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });

    const json = await parseResponseJson(res);

    if (!res.ok) {
      throw new Error(json.error || 'Failed to disconnect account');
    }
  }

  public close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
