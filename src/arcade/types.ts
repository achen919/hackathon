import type { ParticipantId } from '../types';

export type ArcadeCategory = 'competition' | 'cooperation' | 'sport' | 'adventure' | 'strategy';

/**
 * Client-owned fallback engines used when a generated artifact cannot start.
 * Complete AI-generated HTML/CSS/JS runs separately in GeneratedGameSandbox;
 * it is never evaluated or mounted in the parent window.
 */
export type ArcadeGameKind =
  | 'basketball-duel'
  | 'neon-paddles'
  | 'meteor-rescue'
  | 'ruins-relay'
  | 'signal-grid';

export interface ArcadeTheme {
  accent: 'coral' | 'violet' | 'mint' | 'gold' | 'blue';
  backdrop: 'court' | 'night' | 'space' | 'jungle' | 'tabletop';
}

export interface ArcadeGameDefinition {
  schemaVersion: 1;
  engine: 'arcade-v1';
  kind: ArcadeGameKind;
  category: ArcadeCategory;
  title: string;
  subtitle: string;
  durationSeconds: number;
  seed: number;
  theme: ArcadeTheme;
  /** Short, public-chat-derived labels used as collectables/level names. */
  topicTokens: string[];
}

export interface ArcadePlayer {
  nickname: string;
}

export interface ArcadePoint {
  x: number;
  y: number;
}

/**
 * Declarative, range-bounded controls. A server can validate these without
 * executing generated code. Coordinates are normalized to 0..1.
 */
export type ArcadeGameInput =
  | { kind: 'basketball.aim'; angle: number }
  | { kind: 'basketball.charge'; active: boolean }
  | { kind: 'basketball.shoot'; angle: number; power: number }
  | { kind: 'basketball.hoop'; x: number }
  | { kind: 'paddles.move'; y: number }
  | { kind: 'rescue.steer'; x: number }
  | { kind: 'rescue.shield' }
  | { kind: 'ruins.move'; direction: -1 | 0 | 1 }
  | { kind: 'ruins.jump' }
  | { kind: 'ruins.bridge'; lane: 0 | 1 | 2 }
  | { kind: 'strategy.place'; cell: number }
  | { kind: 'session.restart' };

export interface ArcadeInputEvent {
  eventId: string;
  participantId: ParticipantId;
  /** Monotonic per-player value. The server may replace it with its own cursor. */
  sequence: number;
  clientAtMs: number;
  input: ArcadeGameInput;
}

export interface ArcadeGameResult {
  kind: ArcadeGameKind;
  category: ArcadeCategory;
  score: Record<ParticipantId, number>;
  outcome: 'a' | 'b' | 'draw' | 'together';
  headline: string;
}

export interface ArcadeGameRuntimeProps {
  definition: ArcadeGameDefinition;
  viewer: ParticipantId;
  players: Record<ParticipantId, ArcadePlayer>;
  /** Change to reset local physics and replay bookkeeping for a new invite. */
  sessionKey?: string;
  paused?: boolean;
  /**
   * Ordered events returned by the room/game endpoint. The runtime applies each
   * event id once and optimistically applies locally-created events immediately.
   */
  remoteEvents?: readonly ArcadeInputEvent[];
  /** Send the complete envelope as an `arcade.input` action payload. */
  onInput?: (event: ArcadeInputEvent) => void | Promise<void>;
  onComplete?: (result: ArcadeGameResult) => void;
  onViewerChange?: (viewer: ParticipantId) => void;
  onExit?: () => void;
  /** Defaults to local-preview when no network props are supplied. */
  mode?: 'local-preview' | 'network';
  /** Useful for case/demo preview; production play normally keeps this false. */
  allowPerspectiveSwitch?: boolean;
  className?: string;
}
