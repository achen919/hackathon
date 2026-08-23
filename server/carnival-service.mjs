import { createHash, randomBytes, randomInt as cryptoRandomInt, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ARCADE_GAME_ENGINE,
  ARCADE_GAME_SCHEMA_VERSION,
  advanceArcadeSession,
  applyArcadeAction,
  arcadeSessionProjection,
  assertArcadeGameDefinition,
  createArcadeSession,
  isArcadeGameDefinitionCandidate,
} from './arcade-game.mjs';
import { hasUnsafeContactOrLink, hasUnsafeGameText } from './game-templates.mjs';
import { exclusiveSeriesForId, requireExclusiveSeries } from './exclusive-series.mjs';
import {
  PROMPT_GAME_ENGINE,
  PROMPT_GAME_SCHEMA_VERSION,
  assertPromptGameDefinition,
} from './prompt-game.mjs';

export const CARNIVAL_TEMPLATE_IDS = Object.freeze([
  'profile-riddle',
  'keyword-wheel',
  'rapid-choice',
  'custom',
]);

const STATE_VERSION = 1;
const UNLOCK_MESSAGE_COUNT = 10;
const RAPID_ROUND_MS = 5_000;
const RAPID_NETWORK_GRACE_MS = 750;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
const NON_VISIBLE_GAME_KEYS = new Set([
  'id', 'templateId', 'matchId', 'gameId', 'questionId', 'segmentId',
  'createdAt', 'updatedAt', 'generatedAt', 'expiresAt', 'generatedBy',
  'artifactId', 'codeHash',
  'document',
]);
const SAFE_TOPICS = [
  '博物馆', '逛展', '徒步', '爬山', '露营', '骑行', '跑步', '健身', '做饭', '摄影',
  '旅行', '咖啡', '电影', '音乐', '阅读', '宠物', '桌游', '动漫', '艺术', '周末',
  '早餐', '夜宵', '散步', '游戏',
];

const TEMPLATE_LABELS = Object.freeze({
  'profile-riddle': '资料猜谜局',
  'keyword-wheel': '关键词深挖',
  'rapid-choice': '极限2选1',
  custom: '专属小游戏',
});

const TEMPLATE_PROMPTS = Object.freeze({
  'profile-riddle': '生成三个中性、非敏感的关键词选择组，让双方各选三个词描述对方；答案在双方都提交前必须保密。',
  'keyword-wheel': '生成三到八个来自公开聊天共同点的安全转盘话题，每个话题附一条轻松追问。',
  'rapid-choice': '生成三到五道五秒二选一，选项没有优劣；双方独立完成后，再一起查看答案并讨论为什么选择 A 或 B。',
  custom: '从稳定专属系列生成三轮轮流猜答；每轮由一方私密作答、另一方猜测，猜测锁定后才揭晓本轮。',
});

const DEFAULT_LIMITS = Object.freeze({
  maxParticipants: 500,
  maxRooms: 250,
  maxQueuedPerGender: 250,
  maxMessagesPerRoom: 200,
  maxInvitesPerRoom: 20,
  maxActionsPerInvite: 100,
  maxGameBytes: 96_000,
  queueTtlMs: 15 * 60_000,
  roomTtlMs: 24 * 60 * 60_000,
  inviteTtlMs: 6 * 60 * 60_000,
});

export class CarnivalError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CarnivalError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new CarnivalError(code, message, status);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`Carnival option must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function normalizeLimits(options) {
  return {
    maxParticipants: boundedInteger(options.maxParticipants, DEFAULT_LIMITS.maxParticipants, 2, 10_000),
    maxRooms: boundedInteger(options.maxRooms, DEFAULT_LIMITS.maxRooms, 1, 5_000),
    maxQueuedPerGender: boundedInteger(options.maxQueuedPerGender, DEFAULT_LIMITS.maxQueuedPerGender, 1, 5_000),
    maxMessagesPerRoom: boundedInteger(options.maxMessagesPerRoom, DEFAULT_LIMITS.maxMessagesPerRoom, 10, 5_000),
    maxInvitesPerRoom: boundedInteger(options.maxInvitesPerRoom, DEFAULT_LIMITS.maxInvitesPerRoom, 1, 100),
    maxActionsPerInvite: boundedInteger(options.maxActionsPerInvite, DEFAULT_LIMITS.maxActionsPerInvite, 5, 1_000),
    maxGameBytes: boundedInteger(options.maxGameBytes, DEFAULT_LIMITS.maxGameBytes, 2_000, 256_000),
    queueTtlMs: boundedInteger(options.queueTtlMs, DEFAULT_LIMITS.queueTtlMs, 1_000, 7 * 24 * 60 * 60_000),
    roomTtlMs: boundedInteger(options.roomTtlMs, DEFAULT_LIMITS.roomTtlMs, 1_000, 30 * 24 * 60 * 60_000),
    inviteTtlMs: boundedInteger(options.inviteTtlMs, DEFAULT_LIMITS.inviteTtlMs, 1_000, 30 * 24 * 60 * 60_000),
  };
}

function normalizeString(value, name, { min = 1, max, trim = true } = {}) {
  if (typeof value !== 'string') fail('INVALID_INPUT', `${name} must be a string`, 400);
  const normalized = trim ? value.trim() : value;
  if (CONTROL_CHARACTERS.test(normalized)) {
    fail('INVALID_INPUT', `${name} must not contain control characters`, 400);
  }
  if (normalized.length < min || normalized.length > max) {
    fail('INVALID_INPUT', `${name} must be between ${min} and ${max} characters`, 400);
  }
  return normalized;
}

function normalizeId(value, name) {
  return normalizeString(value, name, { min: 2, max: 120 });
}

function normalizeGender(value) {
  if (value !== 'male' && value !== 'female') {
    fail('INVALID_GENDER', 'gender must be male or female', 400);
  }
  return value;
}

function normalizeTemplateId(value) {
  if (!CARNIVAL_TEMPLATE_IDS.includes(value)) {
    fail('INVALID_TEMPLATE', 'Unsupported carnival game template', 400);
  }
  return value;
}

function normalizeSeriesId(templateId, value) {
  if (templateId !== 'custom') {
    if (value !== undefined && value !== null) {
      fail('INVALID_GAME_SERIES', 'seriesId is only valid for the custom template', 400);
    }
    return null;
  }
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!exclusiveSeriesForId(normalized)) {
    fail('INVALID_GAME_SERIES', 'Unsupported exclusive game series', 400);
  }
  return normalized;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('base64url');
}

function normalizePreviewVersionHash(value) {
  if (value === undefined || value === null) return null;
  const normalized = normalizeString(value, 'previewVersionHash', { min: 43, max: 43 });
  if (!/^[A-Za-z0-9_-]{43}$/.test(normalized)) {
    fail('INVALID_INPUT', 'previewVersionHash must be a SHA-256 base64url digest', 400);
  }
  return normalized;
}

function inviteRequestFingerprint(templateId, seriesId, prompt, previewVersionHash = null) {
  const fields = [templateId, seriesId ?? null, prompt];
  // Preserve the historical three-field digest for invitations made without a
  // preview, while binding preview-backed requests to a one-way token digest.
  if (previewVersionHash) fields.push(previewVersionHash);
  return hashToken(JSON.stringify(fields));
}

function exclusiveActionRequestFingerprint(input) {
  const questionId = typeof input?.questionId === 'string' ? input.questionId.trim() : null;
  if (input?.type === 'exclusive-answer') {
    return hashToken(JSON.stringify([input.type, questionId, input.answer]));
  }
  if (input?.type === 'exclusive-guess') {
    return hashToken(JSON.stringify([input.type, questionId, input.guess]));
  }
  return hashToken(JSON.stringify([input?.type ?? null, questionId]));
}

function arcadeActionRequestFingerprint(input) {
  const control = typeof input?.control === 'string' ? input.control.trim() : null;
  const value = input?.value === undefined ? null : input.value;
  return hashToken(JSON.stringify([input?.type ?? null, input?.seq ?? null, control, value]));
}

function emptyState() {
  return {
    version: STATE_VERSION,
    revision: 0,
    participants: {},
    tokenIndex: {},
    queues: { male: [], female: [] },
    rooms: {},
  };
}

function validateLoadedState(value) {
  if (
    !isRecord(value) ||
    value.version !== STATE_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !isRecord(value.participants) ||
    !isRecord(value.tokenIndex) ||
    !isRecord(value.queues) ||
    !Array.isArray(value.queues.male) ||
    !Array.isArray(value.queues.female) ||
    !isRecord(value.rooms)
  ) {
    fail('STATE_CORRUPT', 'Carnival state file is invalid', 500);
  }
  return value;
}

function clonePublic(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function safeJsonClone(value, maxBytes) {
  let nodes = 0;
  const walk = (item, depth, parentKey = '') => {
    nodes += 1;
    if (nodes > 1_000 || depth > 8) fail('INVALID_GAME', 'game definition is too complex', 400);
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('INVALID_GAME', 'game definition contains an invalid number', 400);
      return item;
    }
    if (typeof item === 'string') {
      const maxStringLength = parentKey === 'document' ? 50_000 : 2_000;
      if (item.length > maxStringLength || CONTROL_CHARACTERS.test(item)) {
        fail('INVALID_GAME', 'game definition contains an invalid string', 400);
      }
      return item;
    }
    if (Array.isArray(item)) {
      if (item.length > 100) fail('INVALID_GAME', 'game definition contains an oversized array', 400);
      return item.map((entry) => walk(entry, depth + 1, parentKey));
    }
    if (!isRecord(item)) fail('INVALID_GAME', 'game definition must contain JSON values only', 400);
    const keys = Object.keys(item);
    if (keys.length > 80) fail('INVALID_GAME', 'game definition contains too many fields', 400);
    const result = {};
    for (const key of keys) {
      if (key.length > 80 || ['__proto__', 'prototype', 'constructor'].includes(key)) {
        fail('INVALID_GAME', 'game definition contains an invalid field', 400);
      }
      result[key] = walk(item[key], depth + 1, key);
    }
    return result;
  };

  const cloned = walk(value, 0);
  const raw = JSON.stringify(cloned);
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    fail('INVALID_GAME', 'game definition is too large', 413);
  }
  return JSON.parse(raw);
}

function hasUnsafeGameContent(value, key = '') {
  if (typeof value === 'string') {
    if (NON_VISIBLE_GAME_KEYS.has(key)) return false;
    return hasUnsafeGameText(value);
  }
  if (Array.isArray(value)) return value.some((item) => hasUnsafeGameContent(item, key));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([childKey, child]) => hasUnsafeGameContent(child, childKey));
}

function uniqueStrings(value, name, {
  minItems,
  maxItems,
  maxLength,
  errorCode = 'INVALID_GAME',
}) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    fail(errorCode, `${name} must contain between ${minItems} and ${maxItems} items`, 400);
  }
  const normalized = value.map((item, index) =>
    normalizeString(item, `${name}[${index}]`, { min: 1, max: maxLength }),
  );
  if (new Set(normalized).size !== normalized.length) {
    fail(errorCode, `${name} must not contain duplicates`, 400);
  }
  return normalized;
}

function validateCarnivalGameDefinition(templateId, seriesId, value, limits) {
  const game = safeJsonClone(value, limits.maxGameBytes);
  if (!isRecord(game)) fail('INVALID_GAME', 'game must be an object', 400);
  if (hasUnsafeGameContent(game)) {
    fail('INVALID_GAME', 'game definition must not contain contact details or links', 400);
  }
  if (game.templateId !== undefined && game.templateId !== templateId) {
    fail('INVALID_GAME', 'game template id does not match the invite', 400);
  }
  if (templateId === 'custom' && game.seriesId !== seriesId) {
    fail('INVALID_GAME', 'game series id does not match the invite', 400);
  }
  normalizeString(game.title, 'game.title', { min: 2, max: 100 });

  if (templateId === 'profile-riddle') {
    if (game.mechanics?.kind !== 'profile-riddle') fail('INVALID_GAME', 'profile game mechanics are required', 400);
    uniqueStrings(game.mechanics.keywordOptions, 'game.mechanics.keywordOptions', {
      minItems: 6,
      maxItems: 12,
      maxLength: 60,
    });
  } else if (templateId === 'keyword-wheel') {
    if (game.mechanics?.kind !== 'keyword-wheel') fail('INVALID_GAME', 'wheel game mechanics are required', 400);
    const segments = game.mechanics.segments;
    if (!Array.isArray(segments) || segments.length < 3 || segments.length > 8) {
      fail('INVALID_GAME', 'wheel game must contain between 3 and 8 segments', 400);
    }
    const ids = new Set();
    for (const [index, segment] of segments.entries()) {
      if (!isRecord(segment)) fail('INVALID_GAME', `wheel segment ${index} is invalid`, 400);
      const id = normalizeId(segment.id, `game.mechanics.segments[${index}].id`);
      if (ids.has(id)) fail('INVALID_GAME', 'wheel segment ids must be unique', 400);
      ids.add(id);
      normalizeString(segment.keyword, `game.mechanics.segments[${index}].keyword`, { max: 40 });
      normalizeString(segment.prompt, `game.mechanics.segments[${index}].prompt`, { max: 300 });
      normalizeString(segment.followUp, `game.mechanics.segments[${index}].followUp`, { max: 300 });
    }
  } else if (templateId === 'rapid-choice') {
    if (game.mechanics?.kind !== 'rapid-choice' || game.mechanics.roundSeconds !== 5) {
      fail('INVALID_GAME', 'rapid-choice mechanics must use a five second round', 400);
    }
    if (!Array.isArray(game.questions) || game.questions.length < 3 || game.questions.length > 5) {
      fail('INVALID_GAME', 'rapid-choice must contain between 3 and 5 questions', 400);
    }
    const ids = new Set();
    for (const [index, question] of game.questions.entries()) {
      if (!isRecord(question)) fail('INVALID_GAME', `rapid question ${index} is invalid`, 400);
      const id = normalizeId(question.id, `game.questions[${index}].id`);
      if (ids.has(id)) fail('INVALID_GAME', 'rapid question ids must be unique', 400);
      ids.add(id);
      normalizeString(question.prompt, `game.questions[${index}].prompt`, { min: 4, max: 300 });
      uniqueStrings(question.options, `game.questions[${index}].options`, {
        minItems: 2,
        maxItems: 2,
        maxLength: 100,
      });
    }
  } else if (templateId === 'custom') {
    const series = requireExclusiveSeries(seriesId);
    if (isArcadeGameDefinitionCandidate(game)) {
      if (
        series.seriesId !== 'prompt-arcade' ||
        game.schemaVersion !== ARCADE_GAME_SCHEMA_VERSION ||
        game.engine !== ARCADE_GAME_ENGINE
      ) {
        fail('INVALID_GAME', 'arcade-v1 is only valid for the prompt-arcade series', 400);
      }
      try {
        assertArcadeGameDefinition(game, { hasUnsafeText: hasUnsafeGameText });
      } catch {
        fail('INVALID_GAME', 'custom arcade game does not match the safe arcade-v1 schema', 400);
      }
      return game;
    }
    if (
      game.mechanics?.kind !== 'exclusive-series' ||
      game.mechanics?.seriesId !== series.seriesId ||
      game.mechanics?.templateKey !== series.templateKey
    ) {
      fail('INVALID_GAME', 'exclusive-series mechanics do not match the selected series', 400);
    }
    const promptGameCandidate = game.schemaVersion === PROMPT_GAME_SCHEMA_VERSION ||
      game.engine !== undefined ||
      game.presentation !== undefined ||
      game.ending !== undefined ||
      game.mechanics?.engine !== undefined ||
      (Array.isArray(game.questions) && game.questions.some(
        (question) => isRecord(question) && question.interaction !== undefined,
      ));
    if (promptGameCandidate) {
      if (game.engine !== PROMPT_GAME_ENGINE || game.mechanics?.engine !== PROMPT_GAME_ENGINE) {
        fail('INVALID_GAME', 'custom prompt game must use exclusive-choice-v1', 400);
      }
      try {
        assertPromptGameDefinition(game, { hasUnsafeText: hasUnsafeGameText });
      } catch {
        fail('INVALID_GAME', 'custom prompt game does not match the exclusive-choice-v1 schema', 400);
      }
      return game;
    }
    if (game.schemaVersion !== 2) {
      fail('INVALID_GAME', 'legacy custom games must use schema version 2', 400);
    }
    if (!Array.isArray(game.questions) || game.questions.length !== 3) {
      fail('INVALID_GAME', 'exclusive-series must contain exactly three questions', 400);
    }
    const ids = new Set();
    for (const [index, question] of game.questions.entries()) {
      if (!isRecord(question)) fail('INVALID_GAME', `exclusive question ${index} is invalid`, 400);
      const id = normalizeId(question.id, `game.questions[${index}].id`);
      if (ids.has(id)) fail('INVALID_GAME', 'exclusive question ids must be unique', 400);
      ids.add(id);
      normalizeString(question.label, `game.questions[${index}].label`, { min: 2, max: 24 });
      normalizeString(question.source, `game.questions[${index}].source`, { min: 4, max: 100 });
      normalizeString(question.prompt, `game.questions[${index}].prompt`, { min: 8, max: 140 });
      uniqueStrings(question.options, `game.questions[${index}].options`, {
        minItems: 3,
        maxItems: 4,
        maxLength: 60,
      });
      normalizeString(question.matchedFollowUp, `game.questions[${index}].matchedFollowUp`, { min: 6, max: 140 });
      normalizeString(question.differentFollowUp, `game.questions[${index}].differentFollowUp`, { min: 6, max: 140 });
    }
  }
  return game;
}

function publicParticipant(participant) {
  return {
    id: participant.id,
    participantId: participant.id,
    nickname: participant.nickname,
    gender: participant.gender,
  };
}

function peerMember(room, participantId) {
  return room.members.find((member) => member.id !== participantId) ?? null;
}

function roomCanInvite(room) {
  return room.status === 'active' && room.textMessageCount >= UNLOCK_MESSAGE_COUNT;
}

function newInvitePrivateState() {
  return {
    profileKeywords: null,
    profileSentence: null,
    rapidStartedAt: null,
    rapidAnswers: {},
    rapidCurrentQuestionIndex: null,
    rapidQuestionStartedAt: null,
    rapidQuestionDeadlineAt: null,
    exclusiveAnswers: {},
    exclusiveGuesses: {},
  };
}

function exclusiveSharedState(invite) {
  if (!isRecord(invite.shared) || !isRecord(invite.shared.exclusive)) {
    invite.shared = {
      ...(isRecord(invite.shared) ? invite.shared : {}),
      exclusive: {
        starterId: invite.creatorId,
        roundIndex: 0,
        revealedRounds: [],
      },
    };
  }
  return invite.shared.exclusive;
}

function isArcadeInvite(invite) {
  return invite?.templateId === 'custom' &&
    invite.game?.schemaVersion === ARCADE_GAME_SCHEMA_VERSION &&
    invite.game?.engine === ARCADE_GAME_ENGINE;
}

function publicArcadeDefinition(game) {
  const definition = clonePublic(game);
  if (definition?.artifact) {
    definition.artifact = {
      artifactId: definition.artifact.artifactId,
      codeHash: definition.artifact.codeHash,
      runtimePath: `/api/carnival/games/runtime/${definition.artifact.artifactId}`,
    };
  }
  return definition;
}

function exclusiveRound(invite, room) {
  const shared = exclusiveSharedState(invite);
  const question = invite.game.questions[shared.roundIndex] ?? null;
  if (!question) return { shared, question: null, answerer: null, guesser: null };
  const starterIndex = Math.max(0, room.members.findIndex((member) => member.id === shared.starterId));
  const answerer = room.members[(starterIndex + shared.roundIndex) % room.members.length];
  const guesser = room.members.find((member) => member.id !== answerer.id) ?? null;
  return { shared, question, answerer, guesser };
}

function exclusiveRevealedResult(invite, questionId) {
  const revealed = invite.shared?.exclusive?.revealedRounds;
  return Array.isArray(revealed) ? revealed.find((result) => result.questionId === questionId) ?? null : null;
}

function invitePrivateState(invite, participantId) {
  if (!invite.privateByParticipant[participantId]) {
    invite.privateByParticipant[participantId] = newInvitePrivateState();
  }
  return invite.privateByParticipant[participantId];
}

function invitePrivateStateForView(invite, participantId) {
  return invite.privateByParticipant[participantId] ?? newInvitePrivateState();
}

function startRapidQuestions(privateState, timestamp) {
  if (privateState.rapidStartedAt !== null) return false;
  privateState.rapidStartedAt = timestamp;
  privateState.rapidCurrentQuestionIndex = 0;
  privateState.rapidQuestionStartedAt = timestamp;
  privateState.rapidQuestionDeadlineAt = timestamp + RAPID_ROUND_MS;
  return true;
}

function publicAction(action, invite, participantId) {
  const privateAction = action.type === 'profile-submit' || action.type === 'rapid-answer' ||
    action.type === 'exclusive-answer' || action.type === 'exclusive-guess' ||
    action.type === 'arcade-input';
  const exclusiveRevealed = action.type.startsWith('exclusive-') && action.payload?.questionId
    ? Boolean(exclusiveRevealedResult(invite, action.payload.questionId))
    : false;
  const alwaysPrivate = action.type === 'arcade-input';
  if (
    privateAction &&
    (alwaysPrivate || invite.status !== 'revealed') &&
    !exclusiveRevealed &&
    action.actorId !== participantId
  ) {
    return {
      id: action.id,
      actorId: action.actorId,
      type: action.type,
      createdAt: action.createdAt,
      hidden: true,
    };
  }
  const result = clonePublic(action);
  delete result.requestFingerprint;
  delete result.requestId;
  return result;
}

function buildReveal(invite, room) {
  if (invite.status !== 'revealed') return null;
  if (isArcadeInvite(invite)) {
    return {
      revealedAt: invite.revealedAt,
      outcome: clonePublic(invite.shared?.arcade?.outcome ?? null),
    };
  }
  if (invite.templateId === 'custom') {
    return {
      revealedAt: invite.revealedAt,
      rounds: clonePublic(invite.shared?.exclusive?.revealedRounds ?? []),
    };
  }
  const answers = {};
  for (const member of room.members) {
    const privateState = invitePrivateStateForView(invite, member.id);
    answers[member.id] = invite.templateId === 'profile-riddle'
      ? {
          keywords: clonePublic(privateState.profileKeywords),
          sentence: privateState.profileSentence,
        }
      : { answers: clonePublic(privateState.rapidAnswers) };
  }
  return { revealedAt: invite.revealedAt, answers };
}

function publicInviteStatus(status) {
  if (status === 'revealed') return 'completed';
  if (status === 'active') return 'playing';
  return 'ready';
}

function inviteRevision(invite) {
  if (isArcadeInvite(invite) && Number.isSafeInteger(invite.arcadeRevision)) {
    return (Array.isArray(invite.joinedParticipantIds) ? invite.joinedParticipantIds.length : 0) +
      invite.arcadeRevision;
  }
  return (Array.isArray(invite.joinedParticipantIds) ? invite.joinedParticipantIds.length : 0) +
    (Array.isArray(invite.actions) ? invite.actions.length : 0);
}

function scopedInvite(invite, room, participantId) {
  const privateState = invitePrivateStateForView(invite, participantId);
  const peer = peerMember(room, participantId);
  const peerPrivate = peer ? invitePrivateStateForView(invite, peer.id) : null;
  const arcadeView = isArcadeInvite(invite)
    ? arcadeSessionProjection(invite.game, invite.shared.arcade, participantId)
    : null;
  const progress = invite.templateId === 'profile-riddle'
    ? {
        selfSubmitted: Boolean(privateState.profileKeywords),
        peerSubmitted: Boolean(peerPrivate?.profileKeywords),
      }
      : invite.templateId === 'rapid-choice'
      ? {
          selfStarted: privateState.rapidStartedAt !== null,
          peerStarted: peerPrivate?.rapidStartedAt !== null,
          selfAnswered: Object.keys(privateState.rapidAnswers).length,
          peerAnswered: Object.keys(peerPrivate?.rapidAnswers ?? {}).length,
          totalQuestions: invite.game.questions.length,
        }
      : arcadeView
        ? {
            phase: arcadeView.phase,
            selfRole: arcadeView.self.role,
            peerRole: arcadeView.peer.role,
            selfReady: arcadeView.self.ready,
            peerReady: arcadeView.peer.ready,
            tick: arcadeView.frame.tick,
          }
      : invite.templateId === 'custom'
        ? (() => {
            const round = exclusiveRound(invite, room);
            const questionId = round.question?.id ?? null;
            const answererState = round.answerer ? invitePrivateStateForView(invite, round.answerer.id) : null;
            const guesserState = round.guesser ? invitePrivateStateForView(invite, round.guesser.id) : null;
            return {
              roundIndex: round.shared.roundIndex,
              totalRounds: invite.game.questions.length,
              questionId,
              answererId: round.answerer?.id ?? null,
              guesserId: round.guesser?.id ?? null,
              answerSubmitted: questionId ? Number.isInteger(answererState?.exclusiveAnswers?.[questionId]) : false,
              guessSubmitted: questionId ? Number.isInteger(guesserState?.exclusiveGuesses?.[questionId]) : false,
            };
          })()
      : null;
  const ownPrivateState = invite.templateId === 'profile-riddle'
    ? {
        keywords: clonePublic(privateState.profileKeywords),
        sentence: privateState.profileSentence,
      }
      : invite.templateId === 'rapid-choice'
      ? {
          startedAt: privateState.rapidStartedAt,
          answers: clonePublic(privateState.rapidAnswers),
          currentQuestionIndex: privateState.rapidCurrentQuestionIndex,
          currentQuestionId: privateState.rapidCurrentQuestionIndex === null
            ? null
            : invite.game.questions[privateState.rapidCurrentQuestionIndex]?.id ?? null,
          questionStartedAt: privateState.rapidQuestionStartedAt,
          deadlineAt: privateState.rapidQuestionDeadlineAt,
        }
      : arcadeView
        ? clonePublic(arcadeView.self)
      : invite.templateId === 'custom'
        ? {
            answers: clonePublic(privateState.exclusiveAnswers),
            guesses: clonePublic(privateState.exclusiveGuesses),
          }
      : null;

  const definition = arcadeView ? publicArcadeDefinition(invite.game) : clonePublic(invite.game);
  const status = publicInviteStatus(invite.status);

  return {
    id: invite.id,
    inviteId: invite.id,
    revision: inviteRevision(invite),
    creatorId: invite.creatorId,
    templateId: invite.templateId,
    seriesId: invite.seriesId ?? null,
    gameLabel: TEMPLATE_LABELS[invite.templateId],
    title: definition.title,
    prompt: invite.prompt,
    promptPreview: invite.prompt.length > 120 ? `${invite.prompt.slice(0, 119)}…` : invite.prompt,
    game: {
      ...definition,
      gameId: invite.id,
      kind: invite.templateId,
      status,
      version: Number.isSafeInteger(definition.schemaVersion) ? definition.schemaVersion : 1,
      definition,
    },
    status,
    internalStatus: invite.status,
    createdAt: invite.createdAt,
    updatedAt: invite.updatedAt,
    expiresAt: invite.expiresAt,
    joinedParticipantIds: [...invite.joinedParticipantIds],
    progress,
    privateState: ownPrivateState,
    shared: arcadeView ? { arcade: arcadeView } : clonePublic(invite.shared),
    reveal: buildReveal(invite, room),
    actions: invite.actions.map((action) => publicAction(action, invite, participantId)),
  };
}

function stateForParticipant(state, participant) {
  const base = {
    revision: state.revision,
    self: publicParticipant(participant),
    peer: null,
    messages: [],
    messageCount: 0,
    unlockAt: UNLOCK_MESSAGE_COUNT,
    canInvite: false,
    invites: [],
  };
  if (participant.status === 'queued') {
    return {
      ...base,
      status: 'queued',
      queuedAt: participant.queuedAt,
      expiresAt: participant.expiresAt,
      room: null,
    };
  }

  const room = state.rooms[participant.roomId];
  if (!room) fail('ROOM_EXPIRED', 'Carnival room is no longer available', 410);
  const peer = peerMember(room, participant.id);
  const messages = clonePublic(room.timeline);
  const invites = room.invites.map((invite) => scopedInvite(invite, room, participant.id));
  const participants = clonePublic(room.members);
  const canInvite = roomCanInvite(room);
  return {
    ...base,
    status: room.status === 'active' ? 'matched' : 'closed',
    peer: peer ? clonePublic(peer) : null,
    room: {
      id: room.id,
      roomId: room.id,
      status: room.status,
      participants,
      messages: messages.filter((item) => item.type === 'text'),
      timeline: messages,
      invites,
      textMessageCount: room.textMessageCount,
      inviteThreshold: UNLOCK_MESSAGE_COUNT,
      canInvite,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      expiresAt: room.expiresAt,
      closedAt: room.closedAt ?? null,
    },
    messages,
    messageCount: room.textMessageCount,
    canInvite,
    invites,
  };
}

function newRoom(roomId, male, female, timestamp, roomTtlMs) {
  return {
    id: roomId,
    status: 'active',
    members: [publicParticipant(male), publicParticipant(female)],
    timeline: [],
    textMessageCount: 0,
    invites: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp + roomTtlMs,
    closedAt: null,
    closedBy: null,
  };
}

function touchRoom(room, timestamp, roomTtlMs) {
  room.updatedAt = timestamp;
  room.expiresAt = timestamp + roomTtlMs;
}

export function createCarnivalService(options = {}) {
  const stateDir = options.stateDir ?? process.env.STATE_DIR ?? 'data';
  const statePath = join(stateDir, 'carnival-state.json');
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : randomUUID;
  const tokenFactory = typeof options.tokenFactory === 'function'
    ? options.tokenFactory
    : () => randomBytes(32).toString('base64url');
  const randomInt = typeof options.randomInt === 'function' ? options.randomInt : cryptoRandomInt;
  const limits = normalizeLimits(options);
  let state = null;
  let chain = Promise.resolve();

  const makeId = (prefix) => `${prefix}_${idFactory()}`;

  async function load() {
    if (state) return;
    try {
      state = validateLoadedState(JSON.parse(await readFile(statePath, 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') state = emptyState();
      else throw error;
    }
  }

  async function persist() {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await chmod(stateDir, 0o700);
    const temporaryPath = `${statePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporaryPath, statePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  function deleteParticipant(participantId) {
    const participant = state.participants[participantId];
    if (!participant) return false;
    if (participant.tokenHash) delete state.tokenIndex[participant.tokenHash];
    delete state.participants[participantId];
    return true;
  }

  function pruneExpired(timestamp) {
    let changed = false;
    for (const gender of ['male', 'female']) {
      const retained = [];
      for (const participantId of state.queues[gender]) {
        const participant = state.participants[participantId];
        if (!participant || participant.status !== 'queued' || participant.expiresAt <= timestamp) {
          if (participant?.status === 'queued') deleteParticipant(participantId);
          changed = true;
        } else retained.push(participantId);
      }
      state.queues[gender] = retained;
    }

    for (const [roomId, room] of Object.entries(state.rooms)) {
      if (room.expiresAt <= timestamp) {
        for (const member of room.members) deleteParticipant(member.id);
        delete state.rooms[roomId];
        changed = true;
        continue;
      }
      const expiredIds = new Set(
        room.invites.filter((invite) => invite.expiresAt <= timestamp).map((invite) => invite.id),
      );
      if (expiredIds.size > 0) {
        room.invites = room.invites.filter((invite) => !expiredIds.has(invite.id));
        room.timeline = room.timeline.filter(
          (item) => item.type !== 'invite' || !expiredIds.has(item.inviteId),
        );
        changed = true;
      }
    }
    return changed;
  }

  function matchQueues(timestamp) {
    let changed = false;
    while (
      state.queues.male.length > 0 &&
      state.queues.female.length > 0 &&
      Object.keys(state.rooms).length < limits.maxRooms
    ) {
      const maleId = state.queues.male.shift();
      const femaleId = state.queues.female.shift();
      const male = state.participants[maleId];
      const female = state.participants[femaleId];
      if (!male || !female || male.status !== 'queued' || female.status !== 'queued') {
        changed = true;
        continue;
      }
      const roomId = makeId('room');
      state.rooms[roomId] = newRoom(roomId, male, female, timestamp, limits.roomTtlMs);
      for (const participant of [male, female]) {
        participant.status = 'matched';
        participant.roomId = roomId;
        participant.expiresAt = timestamp + limits.roomTtlMs;
      }
      changed = true;
    }
    return changed;
  }

  function participantForToken(token) {
    if (typeof token !== 'string' || !OPAQUE_TOKEN_PATTERN.test(token)) {
      fail('UNAUTHORIZED', 'Invalid carnival bearer token', 401);
    }
    const participantId = state.tokenIndex[hashToken(token)];
    const participant = participantId ? state.participants[participantId] : null;
    if (!participant || !participant.tokenHash) {
      fail('UNAUTHORIZED', 'Invalid carnival bearer token', 401);
    }
    return participant;
  }

  function activeRoomFor(participant) {
    if (participant.status !== 'matched' || !participant.roomId) {
      fail('NOT_MATCHED', 'Participant is not in a carnival room', 409);
    }
    const room = state.rooms[participant.roomId];
    if (!room) fail('ROOM_EXPIRED', 'Carnival room is no longer available', 410);
    if (room.status !== 'active') fail('ROOM_CLOSED', 'Carnival room is closed', 409);
    return room;
  }

  function inviteFor(room, inviteId) {
    const normalized = normalizeId(inviteId, 'inviteId');
    const invite = room.invites.find((item) => item.id === normalized);
    if (!invite) fail('INVITE_NOT_FOUND', 'Carnival invite was not found', 404);
    return invite;
  }

  function advanceRoomArcades(room, timestamp) {
    let changed = false;
    for (const invite of room.invites) {
      if (
        !isArcadeInvite(invite) ||
        !invite.shared?.arcade ||
        invite.joinedParticipantIds.length !== room.members.length ||
        !['countdown', 'playing'].includes(invite.shared.arcade.phase)
      ) continue;
      const beforePhase = invite.shared.arcade.phase;
      const beforeTick = Number(invite.shared.arcade.frame?.tick ?? 0);
      advanceArcadeSession(invite.game, invite.shared.arcade, timestamp);
      const advanced = beforePhase !== invite.shared.arcade.phase ||
        beforeTick !== Number(invite.shared.arcade.frame?.tick ?? 0);
      if (!advanced) continue;
      invite.arcadeRevision = Number(invite.arcadeRevision ?? 0) + 1;
      invite.updatedAt = timestamp;
      if (invite.shared.arcade.phase === 'finished' && invite.status !== 'revealed') {
        invite.status = 'revealed';
        invite.revealedAt = invite.shared.arcade.outcome?.completedAt ?? timestamp;
      }
      room.updatedAt = timestamp;
      changed = true;
    }
    return changed;
  }

  function transact(operation) {
    const run = chain.then(async () => {
      await load();
      const beforeMaintenance = structuredClone(state);
      const timestamp = Number(now());
      if (!Number.isFinite(timestamp)) throw new TypeError('Carnival clock must return a finite timestamp');
      try {
        const pruned = pruneExpired(timestamp);
        const matched = matchQueues(timestamp);
        const maintenanceChanged = pruned || matched;
        if (maintenanceChanged) {
          state.revision += 1;
          await persist();
        }
      } catch (error) {
        state = beforeMaintenance;
        throw error;
      }

      const beforeOperation = structuredClone(state);
      try {
        const outcome = await operation(timestamp);
        if (outcome?.changed) {
          state.revision += 1;
          await persist();
        }
        return typeof outcome?.result === 'function' ? outcome.result() : outcome?.result;
      } catch (error) {
        state = beforeOperation;
        throw error;
      }
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async function joinQueue(input) {
    const gender = normalizeGender(input?.gender);
    const nickname = normalizeString(input?.nickname, 'nickname', { min: 1, max: 40 });
    return transact((timestamp) => {
      if (Object.keys(state.participants).length >= limits.maxParticipants) {
        fail('CARNIVAL_FULL', 'Carnival participant capacity has been reached', 429);
      }
      if (state.queues[gender].length >= limits.maxQueuedPerGender) {
        fail('QUEUE_FULL', 'Carnival queue capacity has been reached', 429);
      }
      let token;
      let tokenHash;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        token = tokenFactory();
        if (typeof token !== 'string' || !OPAQUE_TOKEN_PATTERN.test(token)) {
          throw new TypeError('Carnival tokenFactory must return a 20 to 200 character base64url token');
        }
        tokenHash = hashToken(token);
        if (!state.tokenIndex[tokenHash]) break;
        token = null;
      }
      if (!token) throw new Error('Unable to allocate a unique carnival bearer token');
      const participantId = makeId('participant');
      state.participants[participantId] = {
        id: participantId,
        nickname,
        gender,
        status: 'queued',
        roomId: null,
        tokenHash,
        queuedAt: timestamp,
        expiresAt: timestamp + limits.queueTtlMs,
      };
      state.tokenIndex[tokenHash] = participantId;
      state.queues[gender].push(participantId);
      matchQueues(timestamp);
      return {
        changed: true,
        result: () => ({ token, state: stateForParticipant(state, state.participants[participantId]) }),
      };
    });
  }

  async function getState(token) {
    return transact((timestamp) => {
      const participant = participantForToken(token);
      const room = participant.status === 'matched' ? state.rooms[participant.roomId] : null;
      const changed = room?.status === 'active' ? advanceRoomArcades(room, timestamp) : false;
      return { changed, result: () => stateForParticipant(state, participant) };
    });
  }

  async function sendMessage(token, input) {
    const content = normalizeString(input?.content, 'content', { min: 1, max: 1_000 });
    return transact((timestamp) => {
      const participant = participantForToken(token);
      const room = activeRoomFor(participant);
      if (room.textMessageCount >= limits.maxMessagesPerRoom) {
        fail('MESSAGE_LIMIT', 'Carnival room message limit has been reached', 429);
      }
      const message = {
        id: makeId('message'),
        type: 'text',
        senderId: participant.id,
        content,
        createdAt: timestamp,
      };
      room.timeline.push(message);
      room.textMessageCount += 1;
      touchRoom(room, timestamp, limits.roomTtlMs);
      return {
        changed: true,
        result: () => ({ message: clonePublic(message), state: stateForParticipant(state, participant) }),
      };
    });
  }

  async function buildPrompt(token, input) {
    const templateId = normalizeTemplateId(input?.templateId);
    const seriesId = normalizeSeriesId(templateId, input?.seriesId);
    return transact(() => {
      const participant = participantForToken(token);
      const room = activeRoomFor(participant);
      if (!roomCanInvite(room)) {
        fail('INVITE_LOCKED', `At least ${UNLOCK_MESSAGE_COUNT} text messages are required`, 409);
      }
      const publicChat = room.timeline
        .filter((item) => item.type === 'text')
        .map((item) => item.content)
        .join(' ');
      const topics = SAFE_TOPICS.filter((topic) => publicChat.includes(topic)).slice(0, 4);
      const topicLine = topics.length > 0 ? topics.join('、') : '轻松日常和彼此的聊天节奏';
      const series = seriesId ? requireExclusiveSeries(seriesId) : null;
      const seriesLine = series
        ? `\n\n专属系列：${series.title}（${series.seriesId}）\n${series.generationBrief}`
        : '';
      const templatePrompt = seriesId === 'prompt-arcade'
        ? '生成一局真正可操作的双人小游戏；从五种服务端权威引擎中选择，代码只负责隔离画面和 PairPlay 输入，不能决定角色、比分、胜负或联网。'
        : TEMPLATE_PROMPTS[templateId];
      const prompt = `请为这两位游园会搭子生成一局「${TEMPLATE_LABELS[templateId]}」。\n\n当前双方已经交换 ${room.textMessageCount} 条文字消息；只围绕公开聊天中的「${topicLine}」展开。\n\n${templatePrompt}${seriesLine}\n\n不要引用联系方式、住址、收入、健康或其他敏感信息，不评价匹配度，所有答案都没有优劣。`;
      return {
        changed: false,
        result: () => ({
          revision: state.revision,
          templateId,
          seriesId,
          label: TEMPLATE_LABELS[templateId],
          description: templatePrompt,
          prompt,
          maxLength: 1_500,
        }),
      };
    });
  }

  async function createInvite(token, input) {
    const templateId = normalizeTemplateId(input?.templateId);
    const seriesId = normalizeSeriesId(templateId, input?.seriesId);
    const prompt = normalizeString(input?.prompt, 'prompt', { min: 20, max: 1_500 });
    if (hasUnsafeContactOrLink(prompt)) {
      fail('INVALID_INPUT', 'prompt must not contain contact details or links', 400);
    }
    const game = validateCarnivalGameDefinition(templateId, seriesId, input?.game, limits);
    const idempotencyKey = input?.idempotencyKey === undefined || input?.idempotencyKey === null
      ? null
      : normalizeString(input.idempotencyKey, 'idempotencyKey', { min: 20, max: 120 });
    const idempotencyKeyHash = idempotencyKey === null ? null : hashToken(idempotencyKey);
    const previewVersionHash = normalizePreviewVersionHash(input?.previewVersionHash);
    const requestFingerprint = inviteRequestFingerprint(templateId, seriesId, prompt, previewVersionHash);
    return transact((timestamp) => {
      const participant = participantForToken(token);
      const room = activeRoomFor(participant);
      if (!roomCanInvite(room)) {
        fail('INVITE_LOCKED', `At least ${UNLOCK_MESSAGE_COUNT} text messages are required`, 409);
      }
      const existingInvite = idempotencyKeyHash === null
        ? null
        : room.invites.find(
            (item) => item.creatorId === participant.id && item.idempotencyKeyHash === idempotencyKeyHash,
          );
      if (existingInvite) {
        if (existingInvite.requestFingerprint && existingInvite.requestFingerprint !== requestFingerprint) {
          fail('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another invitation', 409);
        }
        return {
          changed: false,
          result: () => ({
            invite: scopedInvite(existingInvite, room, participant.id),
            state: stateForParticipant(state, participant),
            reused: true,
          }),
        };
      }
      if (room.invites.length >= limits.maxInvitesPerRoom) {
        fail('INVITE_LIMIT', 'Carnival room invite limit has been reached', 429);
      }
      const invite = {
        id: makeId('invite'),
        creatorId: participant.id,
        templateId,
        seriesId,
        prompt,
        game,
        idempotencyKeyHash,
        requestFingerprint,
        status: 'open',
        joinedParticipantIds: [participant.id],
        privateByParticipant: {},
        shared: templateId === 'custom'
          ? isArcadeGameDefinitionCandidate(game)
            ? {
                arcade: createArcadeSession(
                  game,
                  room.members.map((member) => member.id),
                  participant.id,
                  timestamp,
                ),
              }
            : { exclusive: { starterId: participant.id, roundIndex: 0, revealedRounds: [] } }
          : null,
        ...(isArcadeGameDefinitionCandidate(game) ? { arcadeRevision: 0 } : {}),
        actions: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: Math.min(timestamp + limits.inviteTtlMs, room.expiresAt),
        revealedAt: null,
      };
      invitePrivateState(invite, participant.id);
      room.invites.push(invite);
      room.timeline.push({
        id: makeId('message'),
        type: 'invite',
        senderId: participant.id,
        inviteId: invite.id,
        templateId,
        seriesId,
        createdAt: timestamp,
      });
      touchRoom(room, timestamp, limits.roomTtlMs);
      invite.expiresAt = Math.min(timestamp + limits.inviteTtlMs, room.expiresAt);
      return {
        changed: true,
        result: () => ({
          invite: scopedInvite(invite, room, participant.id),
          state: stateForParticipant(state, participant),
          reused: false,
        }),
      };
    });
  }

  async function getInviteByIdempotencyKey(token, idempotencyKey, input = null) {
    const normalizedKey = normalizeString(idempotencyKey, 'idempotencyKey', { min: 20, max: 120 });
    const idempotencyKeyHash = hashToken(normalizedKey);
    return transact(() => {
      const participant = participantForToken(token);
      const room = activeRoomFor(participant);
      const invite = room.invites.find(
        (item) => item.creatorId === participant.id && item.idempotencyKeyHash === idempotencyKeyHash,
      );
      if (!invite) return { changed: false, result: null };
      if (input) {
        const templateId = normalizeTemplateId(input.templateId);
        const seriesId = normalizeSeriesId(templateId, input.seriesId);
        const prompt = normalizeString(input.prompt, 'prompt', { min: 20, max: 1_500 });
        const previewVersionHash = normalizePreviewVersionHash(input.previewVersionHash);
        const requestFingerprint = inviteRequestFingerprint(
          templateId,
          seriesId,
          prompt,
          previewVersionHash,
        );
        if (invite.requestFingerprint && invite.requestFingerprint !== requestFingerprint) {
          fail('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another invitation', 409);
        }
      }
      return {
        changed: false,
        result: () => ({
          invite: scopedInvite(invite, room, participant.id),
          state: stateForParticipant(state, participant),
          reused: true,
        }),
      };
    });
  }

  async function getInvite(token, inviteId) {
    return transact((timestamp) => {
      const participant = participantForToken(token);
      const room = activeRoomFor(participant);
      const changed = advanceRoomArcades(room, timestamp);
      const invite = inviteFor(room, inviteId);
      return {
        changed,
        result: () => ({ revision: state.revision, invite: scopedInvite(invite, room, participant.id) }),
      };
    });
  }

  async function joinInvite(token, inviteId) {
    return transact((timestamp) => {
      const participant = participantForToken(token);
      const room = activeRoomFor(participant);
      const invite = inviteFor(room, inviteId);
      if (!invite.joinedParticipantIds.includes(participant.id)) {
        if (invite.joinedParticipantIds.length >= room.members.length) {
          fail('INVITE_FULL', 'Carnival invite already has both participants', 409);
        }
        invite.joinedParticipantIds.push(participant.id);
        invitePrivateState(invite, participant.id);
        invite.status = 'active';
        if (invite.templateId === 'rapid-choice' && invite.joinedParticipantIds.length === room.members.length) {
          for (const member of room.members) {
            startRapidQuestions(invitePrivateState(invite, member.id), timestamp);
          }
        }
        invite.updatedAt = timestamp;
        touchRoom(room, timestamp, limits.roomTtlMs);
        invite.expiresAt = Math.min(timestamp + limits.inviteTtlMs, room.expiresAt);
        return {
          changed: true,
          result: () => ({
            invite: scopedInvite(invite, room, participant.id),
            state: stateForParticipant(state, participant),
          }),
        };
      }
      return {
        changed: false,
        result: () => ({
          invite: scopedInvite(invite, room, participant.id),
          state: stateForParticipant(state, participant),
        }),
      };
    });
  }

  function appendAction(
    invite,
    actorId,
    type,
    payload,
    timestamp,
    requestId = null,
    requestFingerprint = null,
  ) {
    const arcade = isArcadeInvite(invite);
    if (!arcade && invite.actions.length >= limits.maxActionsPerInvite) {
      fail('ACTION_LIMIT', 'Carnival invite action limit has been reached', 429);
    }
    const action = {
      id: makeId('action'),
      actorId,
      type,
      payload: clonePublic(payload),
      ...(requestId ? { requestId } : {}),
      ...(requestFingerprint ? { requestFingerprint } : {}),
      createdAt: timestamp,
    };
    if (arcade && invite.actions.length >= 64) invite.actions.shift();
    invite.actions.push(action);
    if (arcade) invite.arcadeRevision = Number(invite.arcadeRevision ?? 0) + 1;
    invite.updatedAt = timestamp;
    return action;
  }

  async function gameAction(token, inviteId, input) {
    if (!isRecord(input) || typeof input.type !== 'string') {
      fail('INVALID_ACTION', 'Carnival game action is invalid', 400);
    }
    return transact((timestamp) => {
      const participant = participantForToken(token);
      const room = activeRoomFor(participant);
      const invite = inviteFor(room, inviteId);
      if (!invite.joinedParticipantIds.includes(participant.id) || invite.joinedParticipantIds.length !== room.members.length) {
        fail('INVITE_NOT_JOINED', 'Both participants must join this invite first', 409);
      }
      const exclusiveAction = input.type === 'exclusive-answer' || input.type === 'exclusive-guess' || input.type === 'exclusive-next';
      const arcadeAction = input.type === 'arcade-ready' || input.type === 'arcade-input' || input.type === 'arcade-tick';
      const sequencedAction = exclusiveAction || arcadeAction;
      let exclusiveRequestId = null;
      let exclusiveRequestFingerprint = null;
      if (sequencedAction) {
        exclusiveRequestId = normalizeString(input.requestId, 'requestId', { min: 8, max: 120 });
        if (!/^[A-Za-z0-9_-]+$/.test(exclusiveRequestId)) {
          fail('INVALID_ACTION', 'requestId must be base64url text', 400);
        }
        exclusiveRequestFingerprint = arcadeAction
          ? arcadeActionRequestFingerprint(input)
          : exclusiveActionRequestFingerprint(input);
        const replay = invite.actions.find(
          (item) => item.actorId === participant.id && item.requestId === exclusiveRequestId,
        );
        if (replay) {
          const replayFingerprint = replay.requestFingerprint ?? (arcadeAction
            ? arcadeActionRequestFingerprint({ type: replay.type, ...replay.payload })
            : exclusiveActionRequestFingerprint({ type: replay.type, ...replay.payload }));
          if (replayFingerprint !== exclusiveRequestFingerprint) {
            fail('IDEMPOTENCY_CONFLICT', 'requestId was already used for another game action', 409);
          }
          return {
            changed: false,
            result: () => ({
              action: publicAction(replay, invite, participant.id),
              invite: scopedInvite(invite, room, participant.id),
              state: stateForParticipant(state, participant),
              reused: true,
            }),
          };
        }
        if (exclusiveAction && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== inviteRevision(invite))) {
          fail('REVISION_CONFLICT', 'Carnival state changed; refresh before retrying this action', 409);
        }
      }
      if (invite.status === 'revealed') fail('GAME_COMPLETE', 'Carnival game is already revealed', 409);
      let action;

      if (input.type === 'profile-submit') {
        if (invite.templateId !== 'profile-riddle') fail('INVALID_ACTION', 'Action does not match the game template', 400);
        const keywords = uniqueStrings(input.keywords, 'keywords', {
          minItems: 3,
          maxItems: 3,
          maxLength: 60,
          errorCode: 'INVALID_ACTION',
        });
        const sentence = normalizeString(input.sentence, 'sentence', { min: 5, max: 200 });
        if (hasUnsafeContactOrLink(sentence)) {
          fail('INVALID_ACTION', 'Profile sentence must not contain contact details or links', 400);
        }
        const allowed = new Set(invite.game.mechanics.keywordOptions);
        if (keywords.some((keyword) => !allowed.has(keyword))) {
          fail('INVALID_ACTION', 'Profile answer contains a keyword outside this game', 400);
        }
        const privateState = invitePrivateState(invite, participant.id);
        if (privateState.profileKeywords) fail('ALREADY_SUBMITTED', 'Profile answer was already submitted', 409);
        privateState.profileKeywords = keywords;
        privateState.profileSentence = sentence;
        action = appendAction(invite, participant.id, input.type, { keywords, sentence }, timestamp);
        const complete = room.members.every(
          (member) => Boolean(invitePrivateState(invite, member.id).profileKeywords),
        );
        if (complete) {
          invite.status = 'revealed';
          invite.revealedAt = timestamp;
        }
      } else if (input.type === 'wheel-spin') {
        if (invite.templateId !== 'keyword-wheel') fail('INVALID_ACTION', 'Action does not match the game template', 400);
        const segments = invite.game.mechanics.segments;
        const selectedIndex = Number(randomInt(segments.length));
        if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= segments.length) {
          throw new TypeError('Carnival randomInt must return a valid segment index');
        }
        const segment = clonePublic(segments[selectedIndex]);
        action = appendAction(invite, participant.id, input.type, { segmentId: segment.id }, timestamp);
        invite.shared = { lastSpin: { segment, actorId: participant.id, createdAt: timestamp } };
      } else if (input.type === 'rapid-start') {
        if (invite.templateId !== 'rapid-choice') fail('INVALID_ACTION', 'Action does not match the game template', 400);
        const privateState = invitePrivateState(invite, participant.id);
        if (privateState.rapidStartedAt !== null) fail('ALREADY_STARTED', 'Rapid-choice was already started', 409);
        startRapidQuestions(privateState, timestamp);
        action = appendAction(invite, participant.id, input.type, {
          questionId: invite.game.questions[0].id,
          startedAt: timestamp,
          deadlineAt: privateState.rapidQuestionDeadlineAt,
        }, timestamp);
      } else if (input.type === 'rapid-answer') {
        if (invite.templateId !== 'rapid-choice') fail('INVALID_ACTION', 'Action does not match the game template', 400);
        const privateState = invitePrivateState(invite, participant.id);
        if (privateState.rapidStartedAt === null) fail('NOT_STARTED', 'Start rapid-choice before answering', 409);
        const questionId = normalizeId(input.questionId, 'questionId');
        const answeredCount = Object.keys(privateState.rapidAnswers).length;
        const expectedQuestion = invite.game.questions[answeredCount];
        if (!expectedQuestion || expectedQuestion.id !== questionId) {
          fail('INVALID_ACTION_ORDER', 'Rapid-choice answers must follow the question order', 409);
        }
        if (![0, 1, 'timeout'].includes(input.answer)) {
          fail('INVALID_ACTION', 'Rapid-choice answer must be 0, 1, or timeout', 400);
        }
        const late = timestamp > privateState.rapidQuestionDeadlineAt + RAPID_NETWORK_GRACE_MS;
        const recordedAnswer = late ? 'timeout' : input.answer;
        privateState.rapidAnswers[questionId] = recordedAnswer;
        const nextQuestionIndex = answeredCount + 1;
        const nextQuestion = invite.game.questions[nextQuestionIndex] ?? null;
        privateState.rapidCurrentQuestionIndex = nextQuestion ? nextQuestionIndex : null;
        privateState.rapidQuestionStartedAt = nextQuestion ? timestamp : null;
        privateState.rapidQuestionDeadlineAt = nextQuestion ? timestamp + RAPID_ROUND_MS : null;
        action = appendAction(invite, participant.id, input.type, {
          questionId,
          answer: recordedAnswer,
          late,
          nextQuestionId: nextQuestion?.id ?? null,
          nextDeadlineAt: privateState.rapidQuestionDeadlineAt,
        }, timestamp);
        const totalQuestions = invite.game.questions.length;
        const complete = room.members.every(
          (member) => Object.keys(invitePrivateState(invite, member.id).rapidAnswers).length === totalQuestions,
        );
        if (complete) {
          invite.status = 'revealed';
          invite.revealedAt = timestamp;
        }
      } else if (arcadeAction) {
        if (!isArcadeInvite(invite)) fail('INVALID_ACTION', 'Action does not match the game engine', 400);
        const applied = applyArcadeAction(
          invite.game,
          invite.shared.arcade,
          participant.id,
          input,
          timestamp,
        );
        if (!applied.ok) fail(applied.code, applied.message, applied.status);
        action = appendAction(
          invite,
          participant.id,
          input.type,
          applied.payload,
          timestamp,
          exclusiveRequestId,
          exclusiveRequestFingerprint,
        );
        if (applied.completed || invite.shared.arcade.phase === 'finished') {
          invite.status = 'revealed';
          invite.revealedAt = timestamp;
        }
      } else if (input.type === 'exclusive-answer') {
        if (invite.templateId !== 'custom') fail('INVALID_ACTION', 'Action does not match the game template', 400);
        const round = exclusiveRound(invite, room);
        if (!round.question || !round.answerer || !round.guesser) {
          fail('GAME_COMPLETE', 'Exclusive game has no remaining round', 409);
        }
        const questionId = normalizeId(input.questionId, 'questionId');
        if (questionId !== round.question.id) {
          fail('INVALID_ACTION_ORDER', 'Exclusive answer does not match the current round', 409);
        }
        if (participant.id !== round.answerer.id) {
          fail('WRONG_GAME_ROLE', 'Only the current answerer can submit this answer', 403);
        }
        if (!Number.isInteger(input.answer) || input.answer < 0 || input.answer >= round.question.options.length) {
          fail('INVALID_ACTION', 'Exclusive answer is outside this question options', 400);
        }
        const privateState = invitePrivateState(invite, participant.id);
        if (Number.isInteger(privateState.exclusiveAnswers[questionId])) {
          fail('ALREADY_SUBMITTED', 'Exclusive answer was already submitted', 409);
        }
        privateState.exclusiveAnswers[questionId] = input.answer;
        action = appendAction(
          invite,
          participant.id,
          input.type,
          { questionId, answer: input.answer },
          timestamp,
          exclusiveRequestId,
          exclusiveRequestFingerprint,
        );
      } else if (input.type === 'exclusive-guess') {
        if (invite.templateId !== 'custom') fail('INVALID_ACTION', 'Action does not match the game template', 400);
        const round = exclusiveRound(invite, room);
        if (!round.question || !round.answerer || !round.guesser) {
          fail('GAME_COMPLETE', 'Exclusive game has no remaining round', 409);
        }
        const questionId = normalizeId(input.questionId, 'questionId');
        if (questionId !== round.question.id) {
          fail('INVALID_ACTION_ORDER', 'Exclusive guess does not match the current round', 409);
        }
        if (participant.id !== round.guesser.id) {
          fail('WRONG_GAME_ROLE', 'Only the current guesser can submit this guess', 403);
        }
        if (!Number.isInteger(input.guess) || input.guess < 0 || input.guess >= round.question.options.length) {
          fail('INVALID_ACTION', 'Exclusive guess is outside this question options', 400);
        }
        const answererState = invitePrivateState(invite, round.answerer.id);
        const answer = answererState.exclusiveAnswers[questionId];
        if (!Number.isInteger(answer)) {
          fail('ANSWER_NOT_READY', 'Wait for the answerer before submitting a guess', 409);
        }
        const privateState = invitePrivateState(invite, participant.id);
        if (Number.isInteger(privateState.exclusiveGuesses[questionId])) {
          fail('ALREADY_SUBMITTED', 'Exclusive guess was already submitted', 409);
        }
        privateState.exclusiveGuesses[questionId] = input.guess;
        action = appendAction(
          invite,
          participant.id,
          input.type,
          { questionId, guess: input.guess },
          timestamp,
          exclusiveRequestId,
          exclusiveRequestFingerprint,
        );
        round.shared.revealedRounds.push({
          roundIndex: round.shared.roundIndex,
          questionId,
          answererId: round.answerer.id,
          guesserId: round.guesser.id,
          answer,
          guess: input.guess,
          matched: answer === input.guess,
          revealedAt: timestamp,
        });
      } else if (input.type === 'exclusive-next') {
        if (invite.templateId !== 'custom') fail('INVALID_ACTION', 'Action does not match the game template', 400);
        const round = exclusiveRound(invite, room);
        if (!round.question) fail('GAME_COMPLETE', 'Exclusive game has no remaining round', 409);
        const questionId = normalizeId(input.questionId, 'questionId');
        if (questionId !== round.question.id) {
          fail('INVALID_ACTION_ORDER', 'Exclusive next does not match the current round', 409);
        }
        if (!exclusiveRevealedResult(invite, questionId)) {
          fail('ROUND_NOT_REVEALED', 'Both answer and guess are required before the next round', 409);
        }
        const finalRound = round.shared.roundIndex >= invite.game.questions.length - 1;
        if (finalRound) {
          invite.status = 'revealed';
          invite.revealedAt = timestamp;
        } else {
          round.shared.roundIndex += 1;
        }
        action = appendAction(
          invite,
          participant.id,
          input.type,
          {
            questionId,
            nextQuestionId: finalRound ? null : invite.game.questions[round.shared.roundIndex].id,
            completed: finalRound,
          },
          timestamp,
          exclusiveRequestId,
          exclusiveRequestFingerprint,
        );
      } else {
        fail('INVALID_ACTION', 'Unsupported carnival game action', 400);
      }

      touchRoom(room, timestamp, limits.roomTtlMs);
      invite.expiresAt = Math.min(timestamp + limits.inviteTtlMs, room.expiresAt);
      return {
        changed: true,
        result: () => ({
          action: publicAction(action, invite, participant.id),
          invite: scopedInvite(invite, room, participant.id),
          state: stateForParticipant(state, participant),
        }),
      };
    });
  }

  async function getArcadeArtifact(artifactId) {
    const normalized = normalizeString(artifactId, 'artifactId', { min: 41, max: 89 });
    if (!/^artifact_[A-Za-z0-9_-]{32,80}$/.test(normalized)) {
      fail('ARCADE_ARTIFACT_NOT_FOUND', 'Arcade runtime was not found', 404);
    }
    return transact(() => {
      for (const room of Object.values(state.rooms)) {
        const invite = room.invites.find((item) =>
          isArcadeInvite(item) && item.game.artifact?.artifactId === normalized,
        );
        if (!invite) continue;
        try {
          assertArcadeGameDefinition(invite.game, { hasUnsafeText: hasUnsafeGameText });
        } catch {
          fail('STATE_CORRUPT', 'Persisted arcade runtime is invalid', 500);
        }
        return {
          changed: false,
          result: () => ({
            artifactId: normalized,
            codeHash: invite.game.artifact.codeHash,
            document: invite.game.artifact.document,
          }),
        };
      }
      fail('ARCADE_ARTIFACT_NOT_FOUND', 'Arcade runtime was not found', 404);
    });
  }

  async function leave(token) {
    return transact((timestamp) => {
      const participant = participantForToken(token);
      if (participant.status === 'queued') {
        state.queues[participant.gender] = state.queues[participant.gender].filter(
          (participantId) => participantId !== participant.id,
        );
        deleteParticipant(participant.id);
      } else {
        const room = state.rooms[participant.roomId];
        if (room && room.status === 'active') {
          room.status = 'closed';
          room.closedAt = timestamp;
          room.closedBy = participant.id;
          room.updatedAt = timestamp;
          room.expiresAt = Math.min(room.expiresAt, timestamp + Math.min(limits.queueTtlMs, 5 * 60_000));
        }
        deleteParticipant(participant.id);
      }
      return {
        changed: true,
        result: () => ({ revision: state.revision, status: 'left' }),
      };
    });
  }

  return {
    join: joinQueue,
    joinQueue,
    getState,
    sendMessage,
    buildPrompt,
    createInvite,
    getInviteByIdempotencyKey,
    getInvite,
    joinInvite,
    gameAction,
    submitAction: gameAction,
    getArcadeArtifact,
    leave,
  };
}
