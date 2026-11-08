import {
  type PlatformAdapter,
  type PlatformId,
  type AuthStatus,
  type AuthChallenge,
  type NormalizedChat,
  type NormalizedMessage,
} from '../adapter.interface.js';

export class MockWhatsAppAdapter implements PlatformAdapter {
  public readonly platformId: PlatformId = 'whatsapp';
  public readonly accountLabel: string;
  private status: AuthStatus = 'idle';
  private autoAuthDelayMs: number;

  constructor(accountLabel: string = 'personal', autoAuthDelayMs: number = 800) {
    this.accountLabel = accountLabel;
    this.autoAuthDelayMs = autoAuthDelayMs;
  }

  public getStatus(): AuthStatus {
    return this.status;
  }

  public async startAuth(
    onChallenge: (challenge: AuthChallenge) => void,
    onStatus: (status: AuthStatus, error?: string) => void,
    _clean?: boolean | undefined
  ): Promise<void> {
    this.status = 'starting';
    onStatus('starting');

    // Emit QR code challenge
    setTimeout(() => {
      this.status = 'awaiting_challenge';
      onStatus('awaiting_challenge');

      // Sample mock QR payload (standard URL or alphanumeric string)
      const mockQrData = `2@openchat-mock-session-${this.accountLabel}-${Date.now()},mockPublicKey,mockSecretKey`;
      onChallenge({
        challengeType: 'qr_code',
        data: mockQrData,
        prompt: 'Scan this QR code with WhatsApp (Settings > Linked Devices)',
        timestamp: Date.now(),
      });

      // Automatically transition to authenticated after simulated scan
      setTimeout(() => {
        this.status = 'authenticated';
        onStatus('authenticated');
      }, this.autoAuthDelayMs);
    }, 200);
  }

  public async disconnect(): Promise<void> {
    this.status = 'disconnected';
  }

  private unreadCallback: ((id: string, count: number) => void) | null = null;

  public onChatUnreadUpdated(callback: (externalId: string, unreadCount: number) => void): void {
    this.unreadCallback = callback;
  }

  public simulateChatRead(externalId: string): void {
    this.unreadCallback?.(externalId, 0);
  }

  public async listChats(): Promise<NormalizedChat[]> {
    const now = Date.now();

    return [
      {
        externalId: '12036301@c.us',
        platform: 'whatsapp',
        title: 'Alice Smith',
        chatType: 'direct_message',
        unreadCount: 2,
        lastMessageTimestamp: now - 600000,
        metadata: { phone: '+1234567890', isVerified: true },
      },
      {
        externalId: '12036302@c.us',
        platform: 'whatsapp',
        title: 'Bob Jones',
        chatType: 'direct_message',
        unreadCount: 0,
        lastMessageTimestamp: now - 86400000,
        metadata: { phone: '+1234567891' },
      },
      {
        externalId: '12036303@g.us',
        platform: 'whatsapp',
        title: 'Project Alpha Team',
        chatType: 'group',
        unreadCount: 3,
        lastMessageTimestamp: now - 1200000,
        metadata: { participantCount: 8 },
      },
      {
        externalId: '12036304@g.us',
        platform: 'whatsapp',
        title: 'Family Group',
        chatType: 'group',
        unreadCount: 1,
        lastMessageTimestamp: now - 3600000,
        metadata: { participantCount: 5 },
      },
      {
        externalId: '12036305@newsletter',
        platform: 'whatsapp',
        title: 'Open Source Digest',
        chatType: 'channel',
        unreadCount: 0,
        lastMessageTimestamp: now - 172800000,
        metadata: { subscriberCount: 1200 },
      },
    ];
  }

  public async fetchRecentMessages(
    externalChatId: string,
    _limit: number = 20
  ): Promise<NormalizedMessage[]> {
    const now = Date.now();

    if (externalChatId === '12036301@c.us') {
      return [
        {
          externalId: 'msg_w1',
          senderId: '12036301@c.us',
          senderName: 'Alice Smith',
          text: 'Hey! Did you get a chance to check the project specs?',
          timestamp: now - 3600000,
          status: 'read',
        },
        {
          externalId: 'msg_w2',
          senderId: 'me',
          senderName: 'Me',
          text: 'Yes, reviewing them right now.',
          timestamp: now - 3500000,
          status: 'read',
        },
        {
          externalId: 'msg_w3',
          senderId: '12036301@c.us',
          senderName: 'Alice Smith',
          text: 'Awesome, let me know if you need any clarification!',
          timestamp: now - 1800000,
          status: 'delivered',
        },
        {
          externalId: 'msg_w4',
          senderId: '12036301@c.us',
          senderName: 'Alice Smith',
          text: 'Also sent over the design mockups.',
          timestamp: now - 600000,
          status: 'delivered',
        },
      ];
    }

    if (externalChatId === '12036303@g.us') {
      return [
        {
          externalId: 'msg_g1',
          senderId: 'user_dan',
          senderName: 'Dan Lead',
          text: 'Standup at 10:00 AM UTC today.',
          timestamp: now - 7200000,
          status: 'read',
        },
        {
          externalId: 'msg_g2',
          senderId: 'user_carol',
          senderName: 'Carol DevOps',
          text: 'Release v1.2 is scheduled for tonight.',
          timestamp: now - 3600000,
          status: 'delivered',
        },
        {
          externalId: 'msg_g3',
          senderId: 'user_dan',
          senderName: 'Dan Lead',
          text: 'Please ensure all PRs are merged before 4 PM.',
          timestamp: now - 1200000,
          status: 'delivered',
        },
      ];
    }

    return [
      {
        externalId: `msg_${externalChatId}_1`,
        senderId: externalChatId,
        senderName: 'Contact',
        text: 'Hello from WhatsApp!',
        timestamp: now - 1000000,
        status: 'read',
      },
    ];
  }
}
