export type PlatformId = 'whatsapp' | 'system';

export type AuthChallengeType = 'qr_code' | 'otp_input' | 'credentials' | 'web_view_url';

export type AuthStatus =
  | 'idle'
  | 'starting'
  | 'awaiting_challenge'
  | 'authenticated'
  | 'failed'
  | 'disconnected';

export interface AuthChallenge {
  challengeType: AuthChallengeType;
  data: string; // e.g. raw QR string or prompt
  prompt?: string | undefined;
  timestamp: number;
}

export type MetadataScalar = string | number | boolean | null;

export interface NormalizedChat {
  externalId: string;
  platform: PlatformId;
  title: string;
  chatType: 'direct_message' | 'group' | 'channel' | 'broadcast_list';
  unreadCount: number;
  lastMessageTimestamp?: number | undefined;
  metadata?: Record<string, MetadataScalar> | undefined;
}

export interface NormalizedMessage {
  externalId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  metadata?: Record<string, MetadataScalar> | undefined;
}

export interface PlatformAdapter {
  readonly platformId: PlatformId;
  readonly accountLabel: string;
  getStatus(): AuthStatus;
  startAuth(
    onChallenge: (challenge: AuthChallenge) => void,
    onStatus: (status: AuthStatus, error?: string) => void,
    clean?: boolean | undefined
  ): Promise<void>;
  disconnect(): Promise<void>;
  listChats(): Promise<NormalizedChat[]>;
  fetchRecentMessages(externalChatId: string, limit?: number): Promise<NormalizedMessage[]>;
  onChatsUpdated?(callback: () => void): void;
  onChatUnreadUpdated?(callback: (externalId: string, unreadCount: number) => void): void;
}
