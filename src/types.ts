export type ParticipantId = 'a' | 'b';

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
  schemaVersion: 1;
  id: string;
  matchId: string;
  gameType: string;
  title: string;
  eyebrow: string;
  description: string;
  whyItFits: string;
  estimatedMinutes: number;
  topics: string[];
  questions: GameQuestion[];
  generatedBy: 'fallback' | 'ai';
  generatedAt: string;
}

export interface AiGameStatus {
  configured: boolean;
  model: string | null;
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
