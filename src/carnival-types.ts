import type { ReactNode } from 'react';
import type { CarnivalExclusiveSeriesId } from './carnival-exclusive';

export type CarnivalGender = 'female' | 'male';
export type CarnivalSessionStatus = 'queued' | 'matched';
export type CarnivalInviteStatus =
  | 'generating'
  | 'ready'
  | 'joined'
  | 'playing'
  | 'completed'
  | 'failed'
  | 'expired';

export interface CarnivalParticipant {
  participantId: string;
  nickname: string;
  gender: CarnivalGender;
}

export interface CarnivalTextMessage {
  type: 'text';
  messageId: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export interface CarnivalGameType {
  templateId: string;
  label: string;
  description: string;
  enabled: boolean;
  available: boolean;
}

/**
 * This is deliberately an envelope rather than a template-specific game type.
 * The carnival shell owns invitation routing; the injected network-game module
 * owns the definition and private/reveal payloads.
 */
export interface CarnivalNetworkGame {
  gameId: string;
  kind: string;
  status: string;
  version: number;
  definition?: unknown;
}

export interface CarnivalInvite {
  inviteId: string;
  creatorId: string;
  templateId: string;
  /** Identifies the exact sub-series for a custom exclusive game. */
  seriesId?: CarnivalExclusiveSeriesId;
  gameLabel: string;
  title: string;
  promptPreview: string;
  status: CarnivalInviteStatus;
  createdAt: string;
  joinedParticipantIds: string[];
  game?: CarnivalNetworkGame | null;
}

export interface CarnivalInviteView extends CarnivalInvite {
  /** Only the requesting participant's private state may be returned here. */
  privateState?: unknown;
  /** The server must omit this until the game has reached a reveal state. */
  reveal?: unknown;
}

export interface CarnivalRoom {
  roomId: string;
  participants: CarnivalParticipant[];
  messages: CarnivalTextMessage[];
  invites: CarnivalInvite[];
  textMessageCount: number;
  inviteThreshold: number;
  canInvite: boolean;
}

export interface CarnivalState {
  /** Monotonic server revision. Older polling responses must never replace it. */
  revision: number;
  status: CarnivalSessionStatus;
  self: CarnivalParticipant;
  room?: CarnivalRoom;
  canInvite: boolean;
  gameTypes: CarnivalGameType[];
  queuedAt?: string;
  serverTime?: string;
}

export interface CarnivalJoinInput {
  nickname: string;
  gender: CarnivalGender;
}

export interface CarnivalJoinResponse {
  token: string;
  state: CarnivalState;
}

export interface CarnivalPromptPreview {
  templateId: string;
  seriesId?: CarnivalExclusiveSeriesId;
  label: string;
  description: string;
  prompt: string;
  maxLength: number;
}

export interface CarnivalCreateInviteInput {
  templateId: string;
  /** Required when templateId is custom. */
  seriesId?: CarnivalExclusiveSeriesId;
  prompt: string;
  /** Sent as an Idempotency-Key header, not included in the JSON body. */
  idempotencyKey: string;
}

export interface CarnivalInviteResponse {
  invite: CarnivalInviteView;
  state: CarnivalState;
}

export interface CarnivalGameActionInput {
  inviteId: string;
  action: string;
  payload?: unknown;
}

export interface CarnivalGameActionResponse {
  invite: CarnivalInviteView;
  state: CarnivalState;
}

export interface CarnivalApi {
  join(input: CarnivalJoinInput, signal?: AbortSignal): Promise<CarnivalJoinResponse>;
  getState(token: string, signal?: AbortSignal): Promise<CarnivalState>;
  sendMessage(token: string, content: string, signal?: AbortSignal): Promise<CarnivalState>;
  getPrompt(
    token: string,
    templateId: string,
    signal?: AbortSignal,
    seriesId?: CarnivalExclusiveSeriesId,
  ): Promise<CarnivalPromptPreview>;
  createInvite(
    token: string,
    input: CarnivalCreateInviteInput,
    signal?: AbortSignal,
  ): Promise<CarnivalInviteResponse>;
  gameAction(
    token: string,
    input: CarnivalGameActionInput,
    signal?: AbortSignal,
  ): Promise<CarnivalGameActionResponse>;
  deleteSession(token: string, signal?: AbortSignal): Promise<void>;
}

export interface CarnivalNetworkGameContext {
  inviteId: string;
  invitation: CarnivalInvite;
  roomId: string;
  self: CarnivalParticipant;
  partner: CarnivalParticipant;
  /** Always routes the action to this context's inviteId. */
  sendAction(action: string, payload?: unknown): Promise<CarnivalGameActionResponse>;
  refresh(): Promise<CarnivalState>;
  close(): void;
}

export type CarnivalNetworkGameRenderer = (context: CarnivalNetworkGameContext) => ReactNode;
export type CarnivalNetworkGameOpener = (
  context: CarnivalNetworkGameContext,
) => void | Promise<void>;

export interface CarnivalPageProps {
  api?: CarnivalApi;
  /** Defaults to 1000ms. Requests are serialized, so slow polls never overlap. */
  pollIntervalMs?: number;
  storageKey?: string;
  /**
   * Rendered inside the page's accessible modal shell. Takes precedence over
   * onOpenNetworkGame when both are supplied.
   */
  renderNetworkGame?: CarnivalNetworkGameRenderer;
  /** Use this for navigation or an externally-owned game surface. */
  onOpenNetworkGame?: CarnivalNetworkGameOpener;
}
