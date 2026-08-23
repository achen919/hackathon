import type {
  GeneratedGameArtifact,
  GeneratedTemplateRenderer,
  StableGameTemplateId,
} from './types';

export type GeneratedTemplateControl =
  | 'profile.select'
  | 'profile.submit'
  | 'wheel.spin'
  | 'wheel.next'
  | 'rapid.answer'
  | 'rapid.timeout';

const CONTROLS: Record<StableGameTemplateId, readonly GeneratedTemplateControl[]> = {
  'profile-riddle': ['profile.select', 'profile.submit'],
  'keyword-wheel': ['wheel.spin', 'wheel.next'],
  'rapid-choice': ['rapid.answer', 'rapid.timeout'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function artifact(value: unknown): GeneratedGameArtifact | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !['artifactId', 'codeHash', 'runtimePath'].includes(key))) return null;
  const artifactId = typeof value.artifactId === 'string' ? value.artifactId : '';
  const codeHash = typeof value.codeHash === 'string' ? value.codeHash : '';
  const runtimePath = typeof value.runtimePath === 'string' ? value.runtimePath : '';
  if (!/^artifact_[A-Za-z0-9_-]{32,80}$/u.test(artifactId) || !/^[a-f0-9]{64}$/u.test(codeHash) ||
    !/^\/api\/(?:carnival\/)?games\/runtime\/artifact_[A-Za-z0-9_-]{32,80}$/u.test(runtimePath)) return null;
  return { artifactId, codeHash, runtimePath };
}

/** Rejects executable fields and unknown protocol variants at the API edge. */
export function normalizeGeneratedTemplateRenderer(value: unknown): GeneratedTemplateRenderer | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !['engine', 'bridge', 'artifact'].includes(key)) ||
    value.engine !== 'generated-template-v1' || value.bridge !== 'PairPlayTemplate-v1') return null;
  const safeArtifact = artifact(value.artifact);
  return safeArtifact ? { engine: value.engine, bridge: value.bridge, artifact: safeArtifact } : null;
}

export function generatedTemplateControls(templateId: StableGameTemplateId) {
  return CONTROLS[templateId];
}

export function generatedTemplateSeed(renderer: GeneratedTemplateRenderer) {
  return Number.parseInt(renderer.artifact.codeHash.slice(0, 8), 16);
}

export function isProfileSelectValue(value: unknown): value is { slot: number; optionIndex: number } {
  return isRecord(value) && Object.keys(value).length === 2 &&
    Number.isSafeInteger(value.slot) && Number(value.slot) >= 0 && Number(value.slot) <= 2 &&
    Number.isSafeInteger(value.optionIndex) && Number(value.optionIndex) >= 0 && Number(value.optionIndex) <= 2;
}

export function isRapidAnswerValue(value: unknown): value is { questionId: string; answer: 0 | 1 } {
  return isRecord(value) && Object.keys(value).length === 2 &&
    typeof value.questionId === 'string' && /^[A-Za-z0-9_-]{1,40}$/u.test(value.questionId) &&
    (value.answer === 0 || value.answer === 1);
}

export function isRapidTimeoutValue(value: unknown): value is { questionId: string } {
  return isRecord(value) && Object.keys(value).length === 1 &&
    typeof value.questionId === 'string' && /^[A-Za-z0-9_-]{1,40}$/u.test(value.questionId);
}

export function isProfileSubmitValue(value: unknown): value is { selections: [number, number, number] } {
  return isRecord(value) && Object.keys(value).length === 1 && Array.isArray(value.selections) &&
    value.selections.length === 3 && value.selections.every((item) => Number.isSafeInteger(item) && Number(item) >= 0 && Number(item) <= 2);
}
