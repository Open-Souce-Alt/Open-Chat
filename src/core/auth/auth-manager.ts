import { type Database } from 'better-sqlite3';
import { type EventBroadcaster } from '../../server/events.js';
import { type PlatformAdapter } from '../../integrations/adapter.interface.js';
import { WhatsAppAdapter } from '../../integrations/whatsapp/whatsapp.js';
import { MockWhatsAppAdapter } from '../../integrations/whatsapp/mock.js';
import { InstagramAdapter } from '../../integrations/instagram/instagram.js';
import { MockInstagramAdapter } from '../../integrations/instagram/mock.js';
import { SyncEngine } from '../sync/sync-engine.js';
import { type AccountRow, type PlatformId } from '../db/schema.js';

export class AuthManager {
  private db: Database;
  private broadcaster: EventBroadcaster;
  private syncEngine: SyncEngine;
  private activeAdapters: Map<string, PlatformAdapter> = new Map();

  constructor(db: Database, broadcaster: EventBroadcaster) {
    this.db = db;
    this.broadcaster = broadcaster;
    this.syncEngine = new SyncEngine(db, broadcaster);
  }

  public async connect(params: {
    platform: string;
    accountLabel?: string | undefined;
    mock?: boolean | undefined;
    clean?: boolean | undefined;
    autoAuthDelayMs?: number | undefined;
  }): Promise<{ accountId: string }> {
    const platform = params.platform.toLowerCase();
    const accountLabel = (params.accountLabel || 'personal').toLowerCase();

    if (platform !== 'whatsapp' && platform !== 'instagram') {
      throw new Error(`Platform '${platform}' is not supported yet. Only 'whatsapp' and 'instagram' are available.`);
    }

    // SAFETY: platform is validated against 'whatsapp' and 'instagram' above
    const platformId = platform as PlatformId;
    const accountId = `acc_${platformId}_${accountLabel}`;

    const useMock = params.mock === true || process.env.OPENCHAT_MOCK_AUTH === '1';

    let adapter: PlatformAdapter;

    if (platformId === 'whatsapp') {
      adapter = useMock
        ? new MockWhatsAppAdapter(accountLabel, params.autoAuthDelayMs ?? 800)
        : new WhatsAppAdapter(accountLabel);
    } else {
      adapter = useMock
        ? new MockInstagramAdapter(accountLabel, params.autoAuthDelayMs ?? 600)
        : new InstagramAdapter(accountLabel);
    }

    this.activeAdapters.set(accountId, adapter);

    // Run auth flow asynchronously
    adapter
      .startAuth(
        (challenge) => {
          this.broadcaster.broadcast({
            type: 'auth:challenge',
            platform: platformId,
            accountLabel,
            accountId,
            challenge: {
              challengeType: challenge.challengeType,
              data: challenge.data,
              prompt: challenge.prompt,
              timestamp: challenge.timestamp,
            },
            timestamp: Date.now(),
          });
        },
        async (status, error) => {
          this.broadcaster.broadcast({
            type: 'auth:status',
            platform: platformId,
            accountLabel,
            accountId,
            status,
            error,
            timestamp: Date.now(),
          });

          if (status === 'authenticated') {
            const executeSync = async () => {
              try {
                const syncResult = await this.syncEngine.runDiscoverySync(adapter);
                this.broadcaster.broadcast({
                  type: 'sync:complete',
                  accountId,
                  systemRootDir: syncResult.systemRootDir,
                  chatCount: syncResult.chatCount,
                  messageCount: syncResult.messageCount,
                  timestamp: Date.now(),
                });
              } catch (syncErr: unknown) {
                const message = syncErr instanceof Error ? syncErr.message : String(syncErr);
                console.error(`[AuthManager] Discovery sync error for ${accountId}:`, message);
              }
            };

            // Hook continuous sync: as mobile device streams DMs and contacts, sync into SQLite
            adapter.onChatsUpdated?.(() => {
              executeSync().catch(() => {});
            });

            // Hook live unread count updates (e.g. read on mobile app)
            adapter.onChatUnreadUpdated?.((externalChatId, unreadCount) => {
              try {
                this.db
                  .prepare(
                    `
                  UPDATE chats
                  SET unread_count = ?, updated_at = ?
                  WHERE account_id = ? AND external_id = ?
                `
                  )
                  .run(unreadCount, Date.now(), accountId, externalChatId);

                // Broadcast VFS update so directory unread counts update live
                this.broadcaster.broadcastVfsChange('mv', externalChatId);
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                console.error('[AuthManager] Error updating chat unread count:', message);
              }
            });

            // Initial sync immediately upon connection
            await executeSync();
          }
        },
        params.clean
      )
      .catch((err: Error) => {
        const message = err.message || String(err);
        this.broadcaster.broadcast({
          type: 'auth:status',
          platform: platformId,
          accountLabel,
          accountId,
          status: 'failed',
          error: message,
          timestamp: Date.now(),
        });
      });

    return { accountId };
  }

  public async submitChallengeResponse(accountId: string, response: string): Promise<void> {
    const adapter = this.activeAdapters.get(accountId);

    if (!adapter) {
      throw new Error(`No active adapter session found for account: ${accountId}`);
    }

    if (!adapter.submitChallengeResponse) {
      throw new Error(`Platform adapter for ${accountId} does not support challenge responses.`);
    }

    await adapter.submitChallengeResponse(response);
  }

  public async disconnect(accountId: string): Promise<void> {
    const adapter = this.activeAdapters.get(accountId);

    if (adapter) {
      await adapter.disconnect();
      this.activeAdapters.delete(accountId);
    }

    this.db.prepare("UPDATE accounts SET status = 'disconnected' WHERE id = ?").run(accountId);
  }

  public listAccounts(): AccountRow[] {
    // SAFETY: Query matches AccountRow schema
    return this.db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all() as AccountRow[];
  }
}
