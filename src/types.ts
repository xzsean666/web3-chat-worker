export interface Env {
  DB: D1Database;
  VOICE_BUCKET: R2Bucket;
  FACTORY_ADDRESS?: string;
  RPC_URLS?: string;
  CHAIN_ID?: string | number;
  RPC_CACHE_TTL_SECONDS?: string | number;
  MESSAGE_RECALL_WINDOW_SECONDS?: string | number;
  EPHEMERAL_FALLBACK_TTL_SECONDS?: string | number;
}

export type MessageType = 'text' | 'voice' | 'image' | 'file';
export type RetentionType = 'permanent' | 'on_read';
export type MessageStatus = 'pending' | 'delivered' | 'read';

export interface NonceRow {
  id: string;
  wallet_address: string;
  nonce: string;
  expires_at: number;
  created_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: MessageType;
  content: string | null;
  retention: RetentionType;
  status: MessageStatus;
  expires_at: number;
  delivered_at: number | null;
  read_at: number | null;
  created_at: number;
  recalled_at?: number | null;
  burn_after_seconds?: number | null;
  mentions?: string | null;
}

export interface MessageReceiptRow {
  id: string;
  message_id: string;
  user_id: string;
  status: 'delivered' | 'read';
  timestamp: number;
}

export interface VoiceMessageRow {
  id: string;
  message_id: string;
  object_key: string;
  duration: number;
  mime_type: string;
  size: number;
  created_at: number;
}

export interface ImageMessageRow {
  id: string;
  message_id: string;
  object_key: string;
  file_name: string | null;
  mime_type: string;
  size: number;
  width: number | null;
  height: number | null;
  created_at: number;
}

export interface FileMessageRow {
  id: string;
  message_id: string;
  object_key: string;
  file_name: string;
  mime_type: string;
  size: number;
  created_at: number;
}

export interface AuthUser {
  id: string;
  wallet_address: string;
  contract_address?: string | null;
  metadata?: Record<string, any>;
}

export type AppVariables = {
  user: AuthUser;
  session: SessionRow;
  token: string;
};

export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
