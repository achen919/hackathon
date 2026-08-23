export type ParticipantId = 'a' | 'b';
export type GameTemplateId = 'profile-riddle' | 'keyword-wheel' | 'rapid-choice' | 'custom';
export type StableGameTemplateId = Exclude<GameTemplateId, 'custom'>;

/** Public, code-free pointer to an isolated generated renderer. */
export interface GeneratedGameArtifact {
  artifactId: string;
  codeHash: string;
  runtimePath: string;
}

/**
 * Stable templates keep their audited mechanics and may opt into an AI-made
 * presentation layer. The executable document is never returned to clients.
 */
export interface GeneratedTemplateRenderer {
  engine: 'generated-template-v1';
  bridge: 'PairPlayTemplate-v1';
  artifact: GeneratedGameArtifact;
}

export interface MatchUser {
  nickname: string;
  gender: string;
  profile: string;
  memories_self: string[];
  memories_ideal: string[];
}

export interface GameResultCard {
  id: string;
  gameId: string;
  gameTitle: string;
  templateId: GameTemplateId;
  status: 'ready' | 'generating' | 'fallback';
  badge: string;
  headline: string;
  score: number;
  summary: string;
  highlights: string[];
  nextPrompt: string;
  backgroundUrl?: string;
  backgroundPrompt?: string;
  generatedBy: 'ai' | 'fallback';
  createdAt: string;
}

export interface MatchMessage {
  from: ParticipantId;
  type: 'text' | 'non_text' | 'game_result' | string;
  content: string;
  sent_at: string;
  gameResult?: GameResultCard;
}

export interface MatchPayload {
  match_id: string;
  match_status: string;
  message_count: number;
  messages: MatchMessage[];
  user_a: MatchUser;
  user_b: MatchUser;
}

export interface GameQuestion {
  id: string;
  label: string;
  source: string;
  prompt: string;
  options: string[];
  matchedFollowUp: string;
  differentFollowUp: string;
}

export interface ProfileRiddleChoiceGroup {
  id: string;
  options: [string, string, string];
}

export interface GameDefinition {
  schemaVersion: 2;
  id: string;
  matchId: string;
  templateId: GameTemplateId;
  gameType: string;
  title: string;
  eyebrow: string;
  description: string;
  whyItFits: string;
  estimatedMinutes: number;
  topics: string[];
  questions: GameQuestion[];
  mechanics:
    | {
        kind: 'profile-riddle';
        /** Three independent, hidden-dimension candidate groups. */
        choiceGroups?: [ProfileRiddleChoiceGroup, ProfileRiddleChoiceGroup, ProfileRiddleChoiceGroup];
        /** Candidate groups keyed by the participant being guessed. */
        choiceGroupsByTarget?: Record<ParticipantId, [ProfileRiddleChoiceGroup, ProfileRiddleChoiceGroup, ProfileRiddleChoiceGroup]>;
        /** Flattened legacy projection kept for persisted games and older clients. */
        keywordOptions: string[];
        sentencePattern: string;
      }
    | {
      kind: 'keyword-wheel';
        segments: Array<{ id: string; keyword: string; prompt: string; followUp: string; followUps?: string[] }>;
      }
    | {
        kind: 'rapid-choice';
        roundSeconds: number;
      }
    | { kind: 'custom' };
  renderer?: GeneratedTemplateRenderer;
  generatedBy: 'fallback' | 'ai';
  generatedAt: string;
}

export interface AiGameStatus {
  configured: boolean;
  model: string | null;
  gameTypes: GameTypeOption[];
}

export interface GameTypeOption {
  id: GameTemplateId;
  label: string;
  templateId: GameTemplateId;
  enabled: boolean;
  available: boolean;
  description: string;
}

export interface GamePromptPreview {
  templateId: GameTemplateId;
  label: string;
  available: boolean;
  description: string;
  prompt: string;
  maxLength: number;
}

export interface AiGameResponse {
  game: GameDefinition;
  cached: boolean;
}

export interface RoundResult {
  question: GameQuestion;
  protagonist: ParticipantId;
  answer: number;
  guess: number;
}

export type GamePhase =
  | 'idle'
  | 'answering'
  | 'handoff'
  | 'guessing'
  | 'revealed'
  | 'complete';
