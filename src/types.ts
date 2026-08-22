export type ParticipantId = 'a' | 'b';
export type GameTemplateId = 'profile-riddle' | 'keyword-wheel' | 'rapid-choice' | 'custom';

export interface MatchUser {
  nickname: string;
  gender: string;
  profile: string;
  memories_self: string[];
  memories_ideal: string[];
}

export interface MatchMessage {
  from: ParticipantId;
  type: 'text' | 'non_text' | string;
  content: string;
  sent_at: string;
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
        keywordOptions: string[];
        sentencePattern: string;
      }
    | {
        kind: 'keyword-wheel';
        segments: Array<{ id: string; keyword: string; prompt: string; followUp: string }>;
      }
    | {
        kind: 'rapid-choice';
        roundSeconds: 5;
      }
    | { kind: 'custom' };
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
