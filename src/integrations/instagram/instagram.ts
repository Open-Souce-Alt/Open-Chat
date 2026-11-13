import { IgApiClient } from 'instagram-private-api';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  type PlatformAdapter,
  type PlatformId,
  type AuthStatus,
  type AuthChallenge,
  type NormalizedChat,
  type NormalizedMessage,
} from '../adapter.interface.js';

export class InstagramAdapter implements PlatformAdapter {
  public readonly platformId: PlatformId = 'instagram';
  public readonly accountLabel: string;
  private status: AuthStatus = 'idle';
  private ig: IgApiClient;
  private twoFactorInfo: { username: string; twoFactorIdentifier: string } | null = null;
  private onStatusCallback: ((status: AuthStatus, error?: string | undefined) => void) | null = null;
  private chatsUpdatedCallback: (() => void) | null = null;
  private unreadUpdatedCallback: ((externalId: string, count: number) => void) | null = null;

  constructor(accountLabel: string = 'personal') {
    this.accountLabel = accountLabel;
    this.ig = new IgApiClient();
  }

  public getStatus(): AuthStatus {
    return this.status;
  }

  public onChatsUpdated(callback: () => void): void {
    this.chatsUpdatedCallback = callback;
  }

  public onChatUnreadUpdated(callback: (externalId: string, unreadCount: number) => void): void {
    this.unreadUpdatedCallback = callback;
  }

  public async startAuth(
    onChallenge: (challenge: AuthChallenge) => void,
    onStatus: (status: AuthStatus, error?: string | undefined) => void,
    clean?: boolean | undefined
  ): Promise<void> {
    this.status = 'starting';
    this.onStatusCallback = onStatus;
    onStatus('starting');

    const sessionDir = path.join(os.homedir(), '.openchat', 'sessions', `instagram_${this.accountLabel}`);
    const stateFile = path.join(sessionDir, 'state.json');

    if (clean && fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch {
        // ignore clean error
      }
    }

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // 1. Try restoring existing session state from disk
    if (fs.existsSync(stateFile) && !clean) {
      try {
        const savedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        await this.ig.state.deserialize(savedState);

        // Verify session validity by requesting direct inbox
        await this.ig.feed.directInbox().records();
        this.status = 'authenticated';
        onStatus('authenticated');

        return;
      } catch {
        // State invalid or expired, continue to fresh auth
      }
    }

    // 2. Fresh login requires credentials
    const username = process.env.OPENCHAT_INSTAGRAM_USERNAME;
    const password = process.env.OPENCHAT_INSTAGRAM_PASSWORD;

    if (!username || !password) {
      this.status = 'awaiting_challenge';
      onStatus('awaiting_challenge');
      onChallenge({
        challengeType: 'credentials',
        data: 'instagram_credentials_required',
        prompt: 'Instagram login required. Set OPENCHAT_INSTAGRAM_USERNAME and OPENCHAT_INSTAGRAM_PASSWORD or provide credentials in connect command.',
        timestamp: Date.now(),
      });

      return;
    }

    try {
      this.ig.state.generateDevice(username);
      await this.ig.simulate.preLoginFlow();
      const loggedInUser = await this.ig.account.login(username, password);

      if (loggedInUser) {
        await this.persistSession(stateFile);
        this.status = 'authenticated';
        onStatus('authenticated');
      }
    } catch (err: unknown) {
      const errorStr = String(err);

      // Check for 2FA requirement
      if (errorStr.includes('checkpoint_required') || errorStr.includes('two_factor_required')) {
        this.status = 'awaiting_challenge';
        onStatus('awaiting_challenge');

        // SAFETY: Instagram API error carries two_factor_info in response body
        const twoFactorIdentifier = (err as { response?: { body?: { two_factor_info?: { two_factor_identifier?: string } } } })?.response?.body?.two_factor_info?.two_factor_identifier || '';
        this.twoFactorInfo = { username, twoFactorIdentifier };

        onChallenge({
          challengeType: 'otp_input',
          data: twoFactorIdentifier,
          prompt: 'Instagram 2FA verification required. Submit your SMS/Authenticator code via the challenge command.',
          timestamp: Date.now(),
        });

        return;
      }

      this.status = 'failed';
      const message = err instanceof Error ? err.message : String(err);
      onStatus('failed', message);
      throw err;
    }
  }

  public async submitChallengeResponse(code: string): Promise<void> {
    if (!this.twoFactorInfo) {
      throw new Error('No pending Instagram 2FA challenge found.');
    }

    const { username, twoFactorIdentifier } = this.twoFactorInfo;
    const sessionDir = path.join(os.homedir(), '.openchat', 'sessions', `instagram_${this.accountLabel}`);
    const stateFile = path.join(sessionDir, 'state.json');

    try {
      await this.ig.account.twoFactorLogin({
        username,
        verificationCode: code.trim(),
        twoFactorIdentifier,
        verificationMethod: '1', // 1: SMS / TOTP
      });

      await this.persistSession(stateFile);
      this.status = 'authenticated';
      this.twoFactorInfo = null;
      this.onStatusCallback?.('authenticated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.onStatusCallback?.('failed', message);
      throw err;
    }
  }

  private async persistSession(stateFile: string): Promise<void> {
    try {
      const serialized = await this.ig.state.serialize();
      // SAFETY: State object contains optional constants property to be cleaned up
      delete (serialized as { constants?: unknown }).constants;
      fs.writeFileSync(stateFile, JSON.stringify(serialized), 'utf8');
    } catch (err: unknown) {
      console.error('[Instagram] Failed to persist session state:', err);
    }
  }

  public async disconnect(): Promise<void> {
    const sessionDir = path.join(os.homedir(), '.openchat', 'sessions', `instagram_${this.accountLabel}`);

    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch {
        // ignore disconnect cleanup
      }
    }

    this.status = 'disconnected';
  }

  public async listChats(): Promise<NormalizedChat[]> {
    if (this.status !== 'authenticated') {
      throw new Error('Instagram adapter is not authenticated');
    }

    const inbox = await this.ig.feed.directInbox().items();
    const chats: NormalizedChat[] = [];

    for (const thread of inbox) {
      const isGroup = Boolean(thread.is_group);

      const title =
        thread.thread_title ||
        thread.users[0]?.full_name ||
        thread.users[0]?.username ||
        'Instagram Direct';

      const lastTimestamp = Number(thread.last_activity_at);

      const lastMessageMs = !Number.isNaN(lastTimestamp) && lastTimestamp > 0
        ? lastTimestamp / 1000 // Instagram activity timestamps are in microseconds
        : undefined;

      chats.push({
        externalId: thread.thread_id,
        platform: this.platformId,
        title,
        chatType: isGroup ? 'group' : 'direct_message',
        unreadCount: 0,
        lastMessageTimestamp: lastMessageMs,
        metadata: {
          isGroup,
          id: thread.thread_id,
        },
      });
    }

    return chats;
  }

  public async fetchRecentMessages(
    externalChatId: string,
    _limit: number = 20
  ): Promise<NormalizedMessage[]> {
    if (this.status !== 'authenticated') {
      throw new Error('Instagram adapter is not authenticated');
    }

    const threadFeed = this.ig.feed.directThread({ thread_id: externalChatId, oldest_cursor: '' });
    const items = await threadFeed.items();
    const messages: NormalizedMessage[] = [];

    for (const item of items) {
      if (item.item_type !== 'text' || !item.text) {
        continue;
      }

      const isMe = String(item.user_id) === String(this.ig.state.cookieUserId);
      const rawTimestamp = Number(item.timestamp);

      const timestampMs = !Number.isNaN(rawTimestamp) && rawTimestamp > 0
        ? rawTimestamp / 1000
        : Date.now();

      messages.push({
        externalId: item.item_id,
        senderId: isMe ? 'me' : String(item.user_id),
        senderName: isMe ? 'Me' : 'Instagram User',
        text: item.text,
        timestamp: timestampMs,
        status: 'read',
      });
    }

    // Return chronological order
    return messages.reverse();
  }
}
