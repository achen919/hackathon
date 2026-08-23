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

export type CarnivalExclusiveInteraction =
  | { kind: 'card-grid'; variant: 'tiles' | 'tickets' }
  | { kind: 'swipe-deck'; variant: 'split' | 'stack' }
  | { kind: 'mood-dial'; variant: 'compass' | 'meter' }
  | { kind: 'orbit-pick'; variant: 'constellation' | 'bubbles' };

export type CarnivalExclusivePresentationTone = 'coral' | 'violet' | 'mint' | 'gold' | 'blue';
export type CarnivalExclusivePresentationScene = 'court' | 'archive' | 'cinema' | 'lab' | 'cosmos';
export type CarnivalExclusivePresentationMotion = 'pop' | 'float' | 'slide' | 'orbit' | 'pulse';
export type CarnivalExclusiveRevealEffect = 'confetti' | 'ripple' | 'spotlight' | 'stars' | 'cards';

export interface CarnivalExclusiveQuestionDefinition {
  id: string;
  label: string;
  source: string;
  prompt: string;
  options: string[];
  /** v2 invitations omit this; renderers must fall back to card-grid/tiles. */
  interaction?: CarnivalExclusiveInteraction;
  matchedFollowUp?: string;
  differentFollowUp?: string;
}

export interface CarnivalExclusiveGeneratedQuestionDefinition extends CarnivalExclusiveQuestionDefinition {
  interaction: CarnivalExclusiveInteraction;
}

export interface CarnivalExclusiveGameDefinition {
  schemaVersion: 3;
  templateId: 'custom';
  seriesId: CarnivalExclusiveSeriesId;
  engine: 'exclusive-choice-v1';
  generatedBy: 'ai' | 'fallback';
  title: string;
  description: string;
  presentation: {
    tone: CarnivalExclusivePresentationTone;
    scene: CarnivalExclusivePresentationScene;
    motion: CarnivalExclusivePresentationMotion;
    revealEffect: CarnivalExclusiveRevealEffect;
  };
  ending: {
    headline: string;
    summary: string;
    chatPrompt: string;
  };
  questions: CarnivalExclusiveGeneratedQuestionDefinition[];
}

export type CarnivalArcadeKind = 'competition' | 'cooperation' | 'sport' | 'adventure' | 'strategy';
export type CarnivalArcadePreset =
  | 'dash-duel'
  | 'tandem-rescue'
  | 'basketball-duel'
  | 'relic-expedition'
  | 'grid-command';

export interface CarnivalArcadeRoleDefinition {
  id: string;
  label: string;
  objective: string;
  controls: string[];
}

/** Public, code-free projection of an executable AI game artifact. */
export interface CarnivalArcadeGameDefinition {
  schemaVersion: 4;
  templateId: 'custom';
  seriesId: 'prompt-arcade';
  engine: 'arcade-v1';
  generatedBy: 'ai' | 'fallback';
  title: string;
  eyebrow: string;
  description: string;
  whyItFits: string;
  estimatedMinutes: number;
  topics: string[];
  arcade: {
    kind: CarnivalArcadeKind;
    preset: CarnivalArcadePreset;
    theme: 'sunset' | 'neon' | 'forest' | 'ocean' | 'cosmos';
    difficulty: 'easy' | 'normal' | 'hard';
    params: Record<string, number>;
    roles: CarnivalArcadeRoleDefinition[];
  };
  artifact: {
    artifactId: string;
    codeHash: string;
    runtimePath: string;
  };
}

export type CarnivalPromptGameDefinition =
  | CarnivalExclusiveGameDefinition
  | CarnivalArcadeGameDefinition;

export interface CarnivalGamePreviewInput {
  templateId: 'custom';
  seriesId: CarnivalExclusiveSeriesId;
  prompt: string;
}

export interface CarnivalGamePreview {
  previewToken: string;
  expiresAt: string;
  game: CarnivalPromptGameDefinition;
}

export interface CarnivalCreateInviteInput {
  templateId: string;
  /** Required when templateId is custom. */
  seriesId?: CarnivalExclusiveSeriesId;
  prompt: string;
  /** Binds the invitation to the exact generated preview the creator played. */
  previewToken?: string;
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
  createGamePreview(
    token: string,
    input: CarnivalGamePreviewInput,
    signal?: AbortSignal,
  ): Promise<CarnivalGamePreview>;
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
