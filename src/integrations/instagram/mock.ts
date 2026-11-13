import {
  type PlatformAdapter,
  type PlatformId,
  type AuthStatus,
  type AuthChallenge,
  type NormalizedChat,
  type NormalizedMessage,
} from '../adapter.interface.js';

export class MockInstagramAdapter implements PlatformAdapter {
  public readonly platformId: PlatformId = 'instagram';
  public readonly accountLabel: string;
  private status: AuthStatus = 'idle';
  private autoAuthDelayMs: number;
  private unreadCallback: ((id: string, count: number) => void) | null = null;
  private chatsUpdatedCallback: (() => void) | null = null;

  constructor(accountLabel: string = 'personal', autoAuthDelayMs: number = 600) {
    this.accountLabel = accountLabel;
    this.autoAuthDelayMs = autoAuthDelayMs;
  }

  public getStatus(): AuthStatus {
    return this.status;
  }

  public onChatsUpdated(callback: () => void): void {
    this.chatsUpdatedCallback = callback;
  }

  public onChatUnreadUpdated(callback: (externalId: string, unreadCount: number) => void): void {
    this.unreadCallback = callback;
  }

  public simulateChatRead(externalId: string): void {
    this.unreadCallback?.(externalId, 0);
  }

  public async startAuth(
    onChallenge: (challenge: AuthChallenge) => void,
    onStatus: (status: AuthStatus, error?: string) => void,
    _clean?: boolean | undefined
  ): Promise<void> {
    this.status = 'starting';
    onStatus('starting');

    // Simulate optional credentials or 2FA challenge
    setTimeout(() => {
      this.status = 'awaiting_challenge';
      onStatus('awaiting_challenge');

      onChallenge({
        challengeType: 'otp_input',
        data: 'instagram_2fa_mock_challenge',
        prompt: 'Enter the 6-digit security code sent to your phone/authenticator app',
        timestamp: Date.now(),
      });

      // Automatically transition to authenticated after simulated 2FA verification
      setTimeout(() => {
        this.status = 'authenticated';
        onStatus('authenticated');
      }, this.autoAuthDelayMs);
    }, 150);
  }

  public async submitChallengeResponse(response: string): Promise<void> {
    if (response) {
      this.status = 'authenticated';
    }
  }

  public async disconnect(): Promise<void> {
    this.status = 'disconnected';
  }

  public async listChats(): Promise<NormalizedChat[]> {
    const now = Date.now();

    return [
      {
        externalId: 'ig_thread_3402823668417103009491281',
        platform: this.platformId,
        title: 'Elena Rostova',
        chatType: 'direct_message',
        unreadCount: 2,
        lastMessageTimestamp: now - 300000,
        metadata: { username: 'elena_rostova', isVerified: true },
      },
      {
        externalId: 'ig_thread_3402823668417103009491282',
        platform: this.platformId,
        title: 'Marcus Vance',
        chatType: 'direct_message',
        unreadCount: 0,
        lastMessageTimestamp: now - 7200000,
        metadata: { username: 'marcus_vance' },
      },
      {
        externalId: 'ig_thread_3402823668417103009491283',
        platform: this.platformId,
        title: 'Street Photography Collective',
        chatType: 'group',
        unreadCount: 4,
        lastMessageTimestamp: now - 60000,
        metadata: { memberCount: 14, isGroup: true },
      },
      {
        externalId: 'ig_thread_3402823668417103009491284',
        platform: this.platformId,
        title: 'Design Critique Hub',
        chatType: 'group',
        unreadCount: 0,
        lastMessageTimestamp: now - 86400000,
        metadata: { memberCount: 6, isGroup: true },
      },
    ];
  }

  public async fetchRecentMessages(
    externalChatId: string,
    _limit: number = 20
  ): Promise<NormalizedMessage[]> {
    const now = Date.now();

    if (externalChatId === 'ig_thread_3402823668417103009491281') {
      return [
        {
          externalId: 'ig_msg_101',
          senderId: 'user_elena',
          senderName: 'Elena Rostova',
          text: 'Hey! Checked out your new photo series, looks incredible!',
          timestamp: now - 600000,
          status: 'read',
        },
        {
          externalId: 'ig_msg_102',
          senderId: 'me',
          senderName: 'Me',
          text: 'Thank you Elena! Really appreciate the feedback.',
          timestamp: now - 500000,
          status: 'read',
        },
        {
          externalId: 'ig_msg_103',
          senderId: 'user_elena',
          senderName: 'Elena Rostova',
          text: 'Let us catch up sometime next week over coffee.',
          timestamp: now - 300000,
          status: 'delivered',
        },
      ];
    }

    if (externalChatId === 'ig_thread_3402823668417103009491283') {
      return [
        {
          externalId: 'ig_msg_201',
          senderId: 'user_david',
          senderName: 'David Lee',
          text: 'Photo walk scheduled for Saturday 4 PM at downtown plaza.',
          timestamp: now - 180000,
          status: 'read',
        },
        {
          externalId: 'ig_msg_202',
          senderId: 'user_sophia',
          senderName: 'Sophia Miller',
          text: 'Bring your 35mm primes!',
          timestamp: now - 60000,
          status: 'delivered',
        },
      ];
    }

    return [
      {
        externalId: `ig_msg_${externalChatId}_1`,
        senderId: externalChatId,
        senderName: 'Instagram User',
        text: 'Hello on Instagram Direct!',
        timestamp: now - 3600000,
        status: 'read',
      },
    ];
  }
}
