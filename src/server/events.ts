import { type WebSocket } from 'ws';
import { type PlatformId } from '../core/db/schema.js';

export type VfsAction = 'mkdir' | 'rmdir' | 'ln' | 'rm' | 'mv' | 'cp';

export interface VfsChangeEvent {
  type: 'vfs:change';
  action: VfsAction;
  path: string;
  timestamp: number;
}

export interface MessageNewEvent {
  type: 'message:new';
  chatId: string;
  message: {
    id: string;
    senderName: string;
    senderId: string;
    text: string;
    timestamp: number;
  };
  timestamp: number;
}

export interface AuthChallengeEvent {
  type: 'auth:challenge';
  platform: PlatformId;
  accountLabel: string;
  accountId: string;
  challenge: {
    challengeType: string;
    data: string;
    prompt?: string | undefined;
    timestamp: number;
  };
  timestamp: number;
}

export interface AuthStatusEvent {
  type: 'auth:status';
  platform: PlatformId;
  accountLabel: string;
  accountId: string;
  status: string;
  error?: string | undefined;
  timestamp: number;
}

export interface SyncCompleteEvent {
  type: 'sync:complete';
  accountId: string;
  systemRootDir: string;
  chatCount: number;
  messageCount: number;
  timestamp: number;
}

export type ServerEvent =
  | VfsChangeEvent
  | MessageNewEvent
  | AuthChallengeEvent
  | AuthStatusEvent
  | SyncCompleteEvent;

export class EventBroadcaster {
  private clients: Set<WebSocket> = new Set();

  public addClient(socket: WebSocket): void {
    this.clients.add(socket);
  }

  public removeClient(socket: WebSocket): void {
    this.clients.delete(socket);
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public broadcast(event: ServerEvent): void {
    const payload = JSON.stringify(event);

    for (const socket of this.clients) {
      if (socket.readyState === 1 /* OPEN */) {
        try {
          socket.send(payload);
        } catch (err) {
          console.error('Error broadcasting to socket client:', err);
          this.clients.delete(socket);
        }
      }
    }
  }

  public broadcastVfsChange(action: VfsAction, path: string): void {
    this.broadcast({
      type: 'vfs:change',
      action,
      path,
      timestamp: Date.now(),
    });
  }
}
