/**
 * Safe, declarative prompt-to-game contract for custom carnival games.
 *
 * The model may choose copy, presentation tokens, and one of four prebuilt
 * selection renderers. It never supplies HTML, CSS, JavaScript, URLs, event
 * handlers, or transition rules. Every interaction still resolves to the
 * option index consumed by the existing exclusive answer/guess state machine.
 */

export const PROMPT_GAME_SCHEMA_VERSION = 3;
export const PROMPT_GAME_ENGINE = 'exclusive-choice-v1';

export const PROMPT_GAME_TONES = Object.freeze(['coral', 'violet', 'mint', 'gold', 'blue']);
export const PROMPT_GAME_SCENES = Object.freeze(['court', 'archive', 'cinema', 'lab', 'cosmos']);
export const PROMPT_GAME_MOTIONS = Object.freeze(['pop', 'float', 'slide', 'orbit', 'pulse']);
export const PROMPT_GAME_REVEALS = Object.freeze(['confetti', 'ripple', 'spotlight', 'stars', 'cards']);
export const PROMPT_GAME_INTERACTIONS = Object.freeze([
  'card-grid',
  'swipe-deck',
  'mood-dial',
  'orbit-pick',
]);

export const PROMPT_GAME_VARIANTS = Object.freeze({
  'card-grid': Object.freeze(['tiles', 'tickets']),
  'swipe-deck': Object.freeze(['split', 'stack']),
  'mood-dial': Object.freeze(['compass', 'meter']),
  'orbit-pick': Object.freeze(['constellation', 'bubbles']),
});

const stringSchema = (minLength, maxLength) => ({ type: 'string', minLength, maxLength });

const questionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'label',
    'source',
    'prompt',
    'options',
    'matchedFollowUp',
    'differentFollowUp',
    'interaction',
  ],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9-]{2,40}$' },
    label: stringSchema(2, 24),
    source: stringSchema(4, 100),
    prompt: stringSchema(8, 140),
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      uniqueItems: true,
      items: stringSchema(1, 60),
    },
    matchedFollowUp: stringSchema(6, 140),
    differentFollowUp: stringSchema(6, 140),
    interaction: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'variant'],
      properties: {
        kind: { type: 'string', enum: [...PROMPT_GAME_INTERACTIONS] },
        variant: {
          type: 'string',
          enum: Object.values(PROMPT_GAME_VARIANTS).flat(),
        },
      },
    },
  },
};

/**
 * Structured-output schema sent to the model. Server-owned fields such as
 * schemaVersion, engine, IDs, seriesId, and mechanics are intentionally absent
 * and are attached only after this payload passes validation.
 */
export const PROMPT_GAME_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'gameType',
    'title',
    'eyebrow',
    'description',
    'whyItFits',
    'estimatedMinutes',
    'topics',
    'presentation',
    'questions',
    'ending',
  ],
  properties: {
    gameType: stringSchema(2, 60),
    title: stringSchema(4, 60),
    eyebrow: stringSchema(2, 30),
    description: stringSchema(10, 240),
    whyItFits: stringSchema(10, 240),
    estimatedMinutes: { type: 'integer', minimum: 2, maximum: 6 },
    topics: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      uniqueItems: true,
      items: stringSchema(2, 24),
    },
    presentation: {
      type: 'object',
      additionalProperties: false,
      required: ['tone', 'scene', 'motion', 'revealEffect'],
      properties: {
        tone: { type: 'string', enum: [...PROMPT_GAME_TONES] },
        scene: { type: 'string', enum: [...PROMPT_GAME_SCENES] },
        motion: { type: 'string', enum: [...PROMPT_GAME_MOTIONS] },
        revealEffect: { type: 'string', enum: [...PROMPT_GAME_REVEALS] },
      },
    },
    questions: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: questionSchema,
    },
    ending: {
      type: 'object',
      additionalProperties: false,
      required: ['headline', 'summary', 'chatPrompt'],
      properties: {
        headline: stringSchema(4, 80),
        summary: stringSchema(10, 200),
        chatPrompt: stringSchema(6, 140),
      },
    },
  },
});

export const PROMPT_GAME_DEFINITION_KEYS = Object.freeze([
  'schemaVersion',
  'engine',
  'id',
  'matchId',
  'templateId',
  'seriesId',
  ...[
    'gameType',
    'title',
    'eyebrow',
    'description',
    'whyItFits',
    'estimatedMinutes',
    'topics',
    'presentation',
    'questions',
    'ending',
  ],
  'mechanics',
  'generatedBy',
  'generatedAt',
]);

const TOP_LEVEL_KEYS = Object.freeze([
  'gameType',
  'title',
  'eyebrow',
  'description',
  'whyItFits',
  'estimatedMinutes',
  'topics',
  'presentation',
  'questions',
  'ending',
]);
const QUESTION_KEYS = Object.freeze([
  'id',
  'label',
  'source',
  'prompt',
  'options',
  'matchedFollowUp',
  'differentFollowUp',
  'interaction',
]);
const PRESENTATION_KEYS = Object.freeze(['tone', 'scene', 'motion', 'revealEffect']);
const INTERACTION_KEYS = Object.freeze(['kind', 'variant']);
const ENDING_KEYS = Object.freeze(['headline', 'summary', 'chatPrompt']);
const CONTROL_OR_BIDI = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;
const EXECUTABLE_MARKUP = /<\/?[a-z][^>]*>|(?:javascript|data\s*:\s*text\/html)\s*:|\bon[a-z]+\s*=|\b(?:eval|function)\s*\(/iu;
const EXTERNAL_REFERENCE = /(?:https?:\/\/|www\.|data\s*:\s*(?:image|text)|blob\s*:)/iu;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function validString(value, min, max) {
  return typeof value === 'string' &&
    value.trim().length >= min &&
    value.trim().length <= max &&
    !CONTROL_OR_BIDI.test(value) &&
    !EXECUTABLE_MARKUP.test(value) &&
    !EXTERNAL_REFERENCE.test(value);
}

function validStringArray(value, minItems, maxItems, minLength, maxLength) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) return false;
  if (!value.every((item) => validString(item, minLength, maxLength))) return false;
  return new Set(value.map((item) => item.trim())).size === value.length;
}

function visibleStrings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(visibleStrings);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => key === 'id' ? [] : visibleStrings(child));
}

export function isPromptGameInteraction(value, optionCount) {
  if (!hasOnlyKeys(value, INTERACTION_KEYS) || Object.keys(value).length !== INTERACTION_KEYS.length) return false;
  if (!PROMPT_GAME_INTERACTIONS.includes(value.kind)) return false;
  if (!PROMPT_GAME_VARIANTS[value.kind].includes(value.variant)) return false;
  if (!Number.isInteger(optionCount)) return false;
  if (value.kind === 'swipe-deck') return optionCount === 2;
  if (value.kind === 'mood-dial' || value.kind === 'orbit-pick') return optionCount >= 3 && optionCount <= 4;
  return optionCount >= 2 && optionCount <= 4;
}

/**
 * Performs strict structural and semantic validation after JSON parsing. The
 * optional unsafe-text predicate lets the caller apply product-specific PII and
 * sensitive-topic rules without coupling this pure DSL module to the app.
 */
export function isPromptGamePayload(value, { hasUnsafeText = () => false } = {}) {
  if (
    !hasOnlyKeys(value, TOP_LEVEL_KEYS) ||
    Object.keys(value).length !== TOP_LEVEL_KEYS.length ||
    !validString(value.gameType, 2, 60) ||
    !validString(value.title, 4, 60) ||
    !validString(value.eyebrow, 2, 30) ||
    !validString(value.description, 10, 240) ||
    !validString(value.whyItFits, 10, 240) ||
    !Number.isInteger(value.estimatedMinutes) ||
    value.estimatedMinutes < 2 ||
    value.estimatedMinutes > 6 ||
    !validStringArray(value.topics, 2, 4, 2, 24) ||
    !hasOnlyKeys(value.presentation, PRESENTATION_KEYS) ||
    Object.keys(value.presentation).length !== PRESENTATION_KEYS.length ||
    !PROMPT_GAME_TONES.includes(value.presentation.tone) ||
    !PROMPT_GAME_SCENES.includes(value.presentation.scene) ||
    !PROMPT_GAME_MOTIONS.includes(value.presentation.motion) ||
    !PROMPT_GAME_REVEALS.includes(value.presentation.revealEffect) ||
    !Array.isArray(value.questions) ||
    value.questions.length !== 3 ||
    !hasOnlyKeys(value.ending, ENDING_KEYS) ||
    Object.keys(value.ending).length !== ENDING_KEYS.length ||
    !validString(value.ending.headline, 4, 80) ||
    !validString(value.ending.summary, 10, 200) ||
    !validString(value.ending.chatPrompt, 6, 140)
  ) return false;

  const ids = new Set();
  for (const question of value.questions) {
    if (
      !hasOnlyKeys(question, QUESTION_KEYS) ||
      Object.keys(question).length !== QUESTION_KEYS.length ||
      !validString(question.id, 2, 40) ||
      !/^[a-z0-9-]+$/.test(question.id) ||
      ids.has(question.id) ||
      !validString(question.label, 2, 24) ||
      !validString(question.source, 4, 100) ||
      !validString(question.prompt, 8, 140) ||
      !validStringArray(question.options, 2, 4, 1, 60) ||
      !validString(question.matchedFollowUp, 6, 140) ||
      !validString(question.differentFollowUp, 6, 140) ||
      !isPromptGameInteraction(question.interaction, question.options.length)
    ) return false;
    ids.add(question.id);
  }

  return !visibleStrings(value).some((text) => hasUnsafeText(text));
}

function payloadFromDefinition(value) {
  if (!isRecord(value)) return null;
  return Object.fromEntries(TOP_LEVEL_KEYS.map((key) => [key, value[key]]));
}

/** Returns a detached, JSON-safe payload or throws a stable validation error. */
export function normalizePromptGamePayload(value, options = {}) {
  if (!isPromptGamePayload(value, options)) {
    const error = new Error('Prompt game did not match the exclusive-choice-v1 schema');
    error.code = 'INVALID_PROMPT_GAME';
    error.status = 400;
    throw error;
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Validates a complete server-owned game definition and returns only the
 * declarative runtime fields needed by HTTP projections and clients.
 */
export function normalizePromptGameDefinition(value, options = {}) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, PROMPT_GAME_DEFINITION_KEYS) ||
    value.schemaVersion !== PROMPT_GAME_SCHEMA_VERSION ||
    value.engine !== PROMPT_GAME_ENGINE ||
    value.templateId !== 'custom' ||
    !isRecord(value.mechanics) ||
    value.mechanics.kind !== 'exclusive-series' ||
    value.mechanics.engine !== PROMPT_GAME_ENGINE
  ) {
    const error = new Error('Invalid exclusive-choice-v1 game definition');
    error.code = 'INVALID_PROMPT_GAME';
    error.status = 400;
    throw error;
  }
  const payload = normalizePromptGamePayload(payloadFromDefinition(value), options);
  return {
    schemaVersion: PROMPT_GAME_SCHEMA_VERSION,
    engine: PROMPT_GAME_ENGINE,
    presentation: payload.presentation,
    questions: payload.questions,
    ending: payload.ending,
  };
}

export function isPromptGameDefinition(value, options = {}) {
  try {
    normalizePromptGameDefinition(value, options);
    return true;
  } catch {
    return false;
  }
}

export function assertPromptGameDefinition(value, options = {}) {
  return normalizePromptGameDefinition(value, options);
}

const SERIES_PRESENTATION = Object.freeze({
  courtside: Object.freeze({ tone: 'coral', scene: 'court', motion: 'pop', revealEffect: 'confetti' }),
  'chat-archaeology': Object.freeze({ tone: 'violet', scene: 'archive', motion: 'slide', revealEffect: 'cards' }),
  'weekend-studio': Object.freeze({ tone: 'mint', scene: 'cinema', motion: 'float', revealEffect: 'spotlight' }),
  'contrast-lab': Object.freeze({ tone: 'gold', scene: 'lab', motion: 'pulse', revealEffect: 'ripple' }),
  'future-trailer': Object.freeze({ tone: 'blue', scene: 'cosmos', motion: 'orbit', revealEffect: 'stars' }),
  'prompt-arcade': Object.freeze({ tone: 'blue', scene: 'cosmos', motion: 'pop', revealEffect: 'stars' }),
});

const SERIES_INTERACTIONS = Object.freeze({
  courtside: Object.freeze(['card-grid', 'swipe-deck', 'mood-dial']),
  'chat-archaeology': Object.freeze(['card-grid', 'orbit-pick', 'card-grid']),
  'weekend-studio': Object.freeze(['swipe-deck', 'mood-dial', 'card-grid']),
  'contrast-lab': Object.freeze(['mood-dial', 'card-grid', 'orbit-pick']),
  'future-trailer': Object.freeze(['orbit-pick', 'swipe-deck', 'card-grid']),
  'prompt-arcade': Object.freeze(['card-grid', 'mood-dial', 'orbit-pick']),
});

function requestedInteractions(prompt) {
  const text = (typeof prompt === 'string' ? prompt : '').replace(
    /(?:不要|别用|不想(?:要)?|拒绝)(?:普通)?(?:滑卡|滑动|左右|二选一|转盘|刻度|指针|仪表|星球|宇宙|轨道|星座|星星|泡泡|卡牌|翻牌|票根|宫格|卡片)/gu,
    '',
  );
  const matches = [
    ['swipe-deck', /(?:滑卡|滑动|左滑|右滑|左右|二选一)/u],
    ['mood-dial', /(?:转盘|刻度|指针|仪表|温度|量表|旋钮)/u],
    // Broad words such as “宇宙/星空” are presentation hints. Requiring an
    // explicit orbit UI noun here keeps the interaction order written by the
    // player (for example: 滑卡、刻度、星球轨道).
    ['orbit-pick', /(?:星球|轨道|星座|环绕|泡泡|节点)/u],
    ['card-grid', /(?:卡牌|翻牌|票根|宫格|卡片)/u],
  ].flatMap(([kind, pattern]) => {
    const index = text.search(pattern);
    return index < 0 ? [] : [{ kind, index }];
  });
  return matches.sort((left, right) => left.index - right.index).map((match) => match.kind);
}

function requestedPresentation(prompt, fallback) {
  const text = typeof prompt === 'string' ? prompt : '';
  if (/(?:宇宙|星球|星座|星空|未来|轨道)/u.test(text)) {
    return { tone: 'blue', scene: 'cosmos', motion: 'orbit', revealEffect: 'stars' };
  }
  if (/(?:电影|短片|预告|镜头|片场)/u.test(text)) {
    return { tone: 'mint', scene: 'cinema', motion: 'float', revealEffect: 'spotlight' };
  }
  if (/(?:实验|反差|量表|仪表|刻度)/u.test(text)) {
    return { tone: 'gold', scene: 'lab', motion: 'pulse', revealEffect: 'ripple' };
  }
  if (/(?:考古|侦探|线索|档案|解谜)/u.test(text)) {
    return { tone: 'violet', scene: 'archive', motion: 'slide', revealEffect: 'cards' };
  }
  if (/(?:篮球|球场|比赛|运动|热血)/u.test(text)) {
    return { tone: 'coral', scene: 'court', motion: 'pop', revealEffect: 'confetti' };
  }
  return { ...fallback };
}

function variantFor(kind, prompt, index) {
  const text = typeof prompt === 'string' ? prompt : '';
  if (kind === 'card-grid') return /(?:票根|电影|车票)/u.test(text) ? 'tickets' : 'tiles';
  if (kind === 'swipe-deck') return /(?:堆叠|卡牌|滑卡)/u.test(text) || index % 2 === 1 ? 'stack' : 'split';
  if (kind === 'mood-dial') return /(?:方向|指南针)/u.test(text) ? 'compass' : 'meter';
  return /(?:泡泡|气泡)/u.test(text) ? 'bubbles' : 'constellation';
}

/**
 * Deterministically compiles safe prompt hints into local visual tokens. Prompt
 * text is classified but never copied into the generated game definition.
 */
export function promptGamePlan(prompt, seriesId) {
  const basePresentation = SERIES_PRESENTATION[seriesId] ?? SERIES_PRESENTATION['future-trailer'];
  const requested = requestedInteractions(prompt);
  const defaults = [...(SERIES_INTERACTIONS[seriesId] ?? SERIES_INTERACTIONS['future-trailer'])];
  const kinds = requested.length === 1
    ? [requested[0], requested[0], requested[0]]
    : requested.length > 1
      ? [...requested, ...defaults.filter((kind) => !requested.includes(kind))].slice(0, 3)
      : defaults;
  return {
    presentation: requestedPresentation(prompt, basePresentation),
    interactions: kinds.map((kind, index) => ({ kind, variant: variantFor(kind, prompt, index) })),
  };
}

export function applyPromptGamePlan(questions, prompt, seriesId) {
  if (!Array.isArray(questions) || questions.length !== 3) {
    throw new TypeError('Prompt game fallback requires exactly three questions');
  }
  const plan = promptGamePlan(prompt, seriesId);
  return {
    presentation: plan.presentation,
    questions: questions.map((question, index) => {
      const interaction = plan.interactions[index];
      const optionLimit = interaction.kind === 'swipe-deck' ? 2 : 4;
      return {
        ...question,
        options: question.options.slice(0, optionLimit),
        interaction,
      };
    }),
  };
}
