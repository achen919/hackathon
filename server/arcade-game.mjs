import { createHash, randomBytes } from 'node:crypto';

/**
 * Safe two-player arcade contract with an isolated generated renderer.
 *
 * A model selects one server-owned preset, bounded numeric tuning, and a
 * self-contained HTML renderer that speaks PairPlay v1. The renderer is served
 * only from a CSP sandbox; it cannot define authoritative controls, physics,
 * roles, network access, or state transitions. Those remain server-owned.
 */

export const ARCADE_GAME_SCHEMA_VERSION = 4;
export const ARCADE_GAME_ENGINE = 'arcade-v1';
export const ARCADE_GAME_SERIES_ID = 'prompt-arcade';

export const ARCADE_GAME_KINDS = Object.freeze([
  'competition',
  'cooperation',
  'sport',
  'adventure',
  'strategy',
]);

export const ARCADE_GAME_PRESETS = Object.freeze([
  'dash-duel',
  'tandem-rescue',
  'basketball-duel',
  'relic-expedition',
  'grid-command',
]);

export const ARCADE_GAME_THEMES = Object.freeze(['sunset', 'neon', 'forest', 'ocean', 'cosmos']);
export const ARCADE_GAME_DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);

const CONTROL_OR_BIDI = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;
const DOCUMENT_CONTROL_OR_BIDI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;
const EXECUTABLE_OR_EXTERNAL = /<\/?[a-z][^>]*>|(?:javascript|data\s*:|blob\s*:|https?:\/\/|www\.)|\bon[a-z]+\s*=|\b(?:eval|function)\s*\(/iu;
const ARCADE_ARTIFACT_ID_PATTERN = /^artifact_[A-Za-z0-9_-]{32,80}$/;
const ARCADE_CODE_HASH_PATTERN = /^[a-f0-9]{64}$/;
const FORBIDDEN_DOCUMENT_CAPABILITY = /(?:https?:\/\/|\/\/[^\s'"`]+|\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|RTCPeerConnection|getUserMedia|open)\b|\b(?:globalThis|window|self|frames|Reflect|Promise|queueMicrotask|MessageChannel|BroadcastChannel|MutationObserver)\b|\bnavigator\s*(?:\.|\[)|\blocation\b|<\s*(?:a|iframe|object|embed|link|base|form|img|audio|video|source|meta\s+http-equiv)\b|\b(?:src|href)\s*=\s*["']\s*(?:data:|blob:|\/\/|https?:)|\bdocument\s*\.\s*(?:cookie|defaultView)\b|\.\s*(?:setAttribute|setAttributeNS)\s*\(\s*["'](?:src|href|action|formaction)["']|\.\s*createElement(?:NS)?\s*\([^)]*["'](?:a|script|iframe|object|embed|link|base|form|img|audio|video|source)["']|\b(?:localStorage|sessionStorage|indexedDB)\b)/iu;
const FORBIDDEN_DOCUMENT_EXECUTION = /(?:\beval\s*\(|\b(?:WebAssembly|SharedArrayBuffer|Atomics|DOMParser|setTimeout|setInterval)\b|\b(?:async|await)\b|\bwhile\s*\(\s*(?:true|1)\s*\)|\bfor\s*\(\s*;\s*;\s*\)|\bdocument\s*\.\s*write(?:ln)?\s*\(|\.\s*(?:innerHTML|outerHTML|constructor|__proto__)\b|\.\s*insertAdjacentHTML\s*\(|\b(?:getPrototypeOf|getOwnPropertyDescriptor)\s*\(|\bthis\b|\bparent\s*\.(?!\s*postMessage\b)|\btop\s*\.|\bopener\b|\bimport\s*\(|\son[a-z]+\s*=)/iu;
const FUNCTION_CONSTRUCTOR = /\b(?:new\s+)?Function\s*\(/u;

const COMMON_PARAM_RANGES = Object.freeze({
  durationMs: [20_000, 90_000],
  tickMs: [40, 250],
  arenaWidth: [600, 1_600],
  arenaHeight: [320, 900],
  primarySpeed: [40, 1_500],
  secondarySpeed: [40, 1_200],
  gravity: [0, 2_400],
  targetSize: [20, 280],
  projectileRadius: [4, 40],
  targetScore: [1, 20],
  maxRounds: [1, 30],
});

const PARAM_KEYS = Object.freeze(Object.keys(COMMON_PARAM_RANGES));

const PRESET_CATALOG = Object.freeze({
  'dash-duel': Object.freeze({
    kind: 'competition',
    title: '并肩冲线 · 反应对决',
    eyebrow: '双人竞技',
    description: '两个人各守一条赛道，用移动和冲刺争取先到终点。',
    topics: Object.freeze(['反应力', '轻竞技']),
    roles: Object.freeze([
      Object.freeze({ id: 'runner-a', label: '橙色选手', objective: '控制节奏并冲向终点', controls: Object.freeze(['move', 'boost']) }),
      Object.freeze({ id: 'runner-b', label: '蓝色选手', objective: '控制节奏并冲向终点', controls: Object.freeze(['move', 'boost']) }),
    ]),
    params: Object.freeze({
      durationMs: 35_000, tickMs: 100, arenaWidth: 1_000, arenaHeight: 500,
      primarySpeed: 220, secondarySpeed: 160, gravity: 0, targetSize: 80,
      projectileRadius: 10, targetScore: 10, maxRounds: 1,
    }),
  }),
  'tandem-rescue': Object.freeze({
    kind: 'cooperation',
    title: '双人救援 · 同步脉冲',
    eyebrow: '合作挑战',
    description: '两名队友在相近时机发出同步信号，一起把救援进度推满。',
    topics: Object.freeze(['默契配合', '合作挑战']),
    roles: Object.freeze([
      Object.freeze({ id: 'pilot', label: '领航员', objective: '调整位置并发送同步信号', controls: Object.freeze(['move', 'sync']) }),
      Object.freeze({ id: 'navigator', label: '导航员', objective: '调整位置并发送同步信号', controls: Object.freeze(['move', 'sync']) }),
    ]),
    params: Object.freeze({
      durationMs: 45_000, tickMs: 100, arenaWidth: 1_000, arenaHeight: 560,
      primarySpeed: 180, secondarySpeed: 180, gravity: 0, targetSize: 120,
      projectileRadius: 12, targetScore: 6, maxRounds: 6,
    }),
  }),
  'basketball-duel': Object.freeze({
    kind: 'sport',
    title: '默契篮球 · 移动篮筐',
    eyebrow: '双人运动',
    description: '一人控制出手角度和力度，一人移动篮筐；命中与防守都有分。',
    topics: Object.freeze(['篮球', '双人攻防']),
    roles: Object.freeze([
      Object.freeze({ id: 'shooter', label: '投篮手', objective: '调整角度和力度完成投篮', controls: Object.freeze(['aim', 'power', 'shoot']) }),
      Object.freeze({ id: 'keeper', label: '篮筐手', objective: '左右移动篮筐完成防守', controls: Object.freeze(['move']) }),
    ]),
    params: Object.freeze({
      durationMs: 45_000, tickMs: 50, arenaWidth: 1_000, arenaHeight: 600,
      primarySpeed: 720, secondarySpeed: 300, gravity: 980, targetSize: 132,
      projectileRadius: 14, targetScore: 5, maxRounds: 10,
    }),
  }),
  'relic-expedition': Object.freeze({
    kind: 'adventure',
    title: '遗迹探险 · 双人护送',
    eyebrow: '双人冒险',
    description: '探索者向前寻找遗物，守护者处理障碍，共同推进探险进度。',
    topics: Object.freeze(['冒险', '双人护送']),
    roles: Object.freeze([
      Object.freeze({ id: 'explorer', label: '探索者', objective: '移动与跳跃寻找遗物', controls: Object.freeze(['move', 'jump']) }),
      Object.freeze({ id: 'guardian', label: '守护者', objective: '移动与防护化解障碍', controls: Object.freeze(['move', 'guard']) }),
    ]),
    params: Object.freeze({
      durationMs: 50_000, tickMs: 100, arenaWidth: 1_200, arenaHeight: 600,
      primarySpeed: 190, secondarySpeed: 150, gravity: 900, targetSize: 100,
      projectileRadius: 12, targetScore: 8, maxRounds: 8,
    }),
  }),
  'grid-command': Object.freeze({
    kind: 'strategy',
    title: '九格指挥 · 预测落点',
    eyebrow: '双人策略',
    description: '双方在九格地图中选择落点并提交指令，用有限回合争夺更多据点。',
    topics: Object.freeze(['策略', '回合对抗']),
    roles: Object.freeze([
      Object.freeze({ id: 'coral-commander', label: '珊瑚指挥官', objective: '选择并提交本回合落点', controls: Object.freeze(['select', 'commit']) }),
      Object.freeze({ id: 'blue-commander', label: '蓝色指挥官', objective: '选择并提交本回合落点', controls: Object.freeze(['select', 'commit']) }),
    ]),
    params: Object.freeze({
      durationMs: 60_000, tickMs: 150, arenaWidth: 900, arenaHeight: 540,
      primarySpeed: 100, secondarySpeed: 100, gravity: 0, targetSize: 90,
      projectileRadius: 10, targetScore: 4, maxRounds: 7,
    }),
  }),
});

const OUTPUT_KEYS = Object.freeze([
  'title', 'eyebrow', 'description', 'whyItFits', 'estimatedMinutes', 'topics',
  'kind', 'preset', 'theme', 'difficulty', 'tuning', 'document',
]);
const TUNING_KEYS = Object.freeze(['durationSeconds', 'speedPercent', 'targetScore', 'maxRounds']);
const DEFINITION_KEYS = Object.freeze([
  'schemaVersion', 'engine', 'id', 'matchId', 'templateId', 'seriesId',
  'gameType', 'title', 'eyebrow', 'description', 'whyItFits', 'estimatedMinutes',
  'topics', 'arcade', 'artifact', 'generatedBy', 'generatedAt',
]);
const ARCADE_KEYS = Object.freeze(['kind', 'preset', 'theme', 'difficulty', 'params', 'roles']);
const ROLE_KEYS = Object.freeze(['id', 'label', 'objective', 'controls']);
const ARTIFACT_KEYS = Object.freeze(['artifactId', 'codeHash', 'document']);

const stringSchema = (minLength, maxLength) => ({ type: 'string', minLength, maxLength });

/** Strict structured-output schema for the manifest plus isolated HTML artifact. */
export const ARCADE_GAME_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [...OUTPUT_KEYS],
  properties: {
    title: stringSchema(4, 60),
    eyebrow: stringSchema(2, 30),
    description: stringSchema(10, 200),
    whyItFits: stringSchema(10, 200),
    estimatedMinutes: { type: 'integer', minimum: 1, maximum: 3 },
    topics: {
      type: 'array', minItems: 2, maxItems: 4, uniqueItems: true,
      items: stringSchema(2, 24),
    },
    kind: { type: 'string', enum: [...ARCADE_GAME_KINDS] },
    preset: { type: 'string', enum: [...ARCADE_GAME_PRESETS] },
    theme: { type: 'string', enum: [...ARCADE_GAME_THEMES] },
    difficulty: { type: 'string', enum: [...ARCADE_GAME_DIFFICULTIES] },
    tuning: {
      type: 'object',
      additionalProperties: false,
      required: [...TUNING_KEYS],
      properties: {
        durationSeconds: { type: 'integer', minimum: 20, maximum: 90 },
        speedPercent: { type: 'integer', minimum: 70, maximum: 140 },
        targetScore: { type: 'integer', minimum: 1, maximum: 20 },
        maxRounds: { type: 'integer', minimum: 1, maximum: 30 },
      },
    },
    document: stringSchema(1_000, 50_000),
  },
});

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
}

function validString(value, min, max) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max &&
    !CONTROL_OR_BIDI.test(value) && !EXECUTABLE_OR_EXTERNAL.test(value);
}

function validStrings(value, minItems, maxItems, minLength, maxLength) {
  return Array.isArray(value) && value.length >= minItems && value.length <= maxItems &&
    value.every((item) => validString(item, minLength, maxLength)) &&
    new Set(value.map((item) => item.trim())).size === value.length;
}

function validInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function arcadeDocumentScripts(value) {
  if (typeof value !== 'string') return [];
  const openings = value.match(/<script\b/giu) ?? [];
  const scripts = [...value.matchAll(/<script\s*>([\s\S]*?)<\/script>/giu)].map((match) => match[1]);
  return openings.length === scripts.length ? scripts : [];
}

export function arcadeScriptCspSources(value) {
  if (!isSafeArcadeDocument(value)) throw new TypeError('Arcade document is not safe to serve');
  return arcadeDocumentScripts(value).map((script) =>
    `'sha256-${createHash('sha256').update(script).digest('base64')}'`
  );
}

export function isSafeArcadeDocument(value) {
  const scripts = arcadeDocumentScripts(value);
  if (
    typeof value !== 'string' ||
    value.length < 1_000 ||
    value.length > 50_000 ||
    DOCUMENT_CONTROL_OR_BIDI.test(value) ||
    FORBIDDEN_DOCUMENT_CAPABILITY.test(value) ||
    FORBIDDEN_DOCUMENT_EXECUTION.test(value) ||
    FUNCTION_CONSTRUCTOR.test(value) ||
    !/^\s*<!doctype html>/iu.test(value) ||
    !/<html\b/iu.test(value) ||
    !/<script\b/iu.test(value) ||
    !/<\/html>\s*$/iu.test(value) ||
    scripts.length !== 1 ||
    !/^\s*["']use strict["']\s*;/u.test(scripts[0]) ||
    !/pairplay\s*:\s*1/u.test(value) ||
    !/game\.bootstrap-ready/u.test(value) ||
    !/game\.ready/u.test(value) ||
    !/game\.input/u.test(value) ||
    !/host\.(?:init|sync)/u.test(value) ||
    !/postMessage\s*\(/u.test(value) ||
    !/addEventListener\s*\(\s*["']message["']/u.test(value)
  ) return false;
  return true;
}

function isMobileBasketballDocument(value) {
  return typeof value === 'string' &&
    /<meta\s+[^>]*name=["']viewport["']/iu.test(value) &&
    /touch-action\s*:/iu.test(value) &&
    /pointerdown/u.test(value) &&
    /pointermove/u.test(value) &&
    /setPointerCapture/u.test(value) &&
    ['aim', 'power', 'shoot', 'move'].every((control) =>
      new RegExp(`["']${control}["']`, 'u').test(value)
    );
}

function presetFor(value) {
  return typeof value === 'string' ? PRESET_CATALOG[value] ?? null : null;
}

export function isArcadeGamePayload(value, { hasUnsafeText = () => false } = {}) {
  if (
    !hasExactKeys(value, OUTPUT_KEYS) ||
    !validString(value.title, 4, 60) ||
    !validString(value.eyebrow, 2, 30) ||
    !validString(value.description, 10, 200) ||
    !validString(value.whyItFits, 10, 200) ||
    !validInteger(value.estimatedMinutes, 1, 3) ||
    !validStrings(value.topics, 2, 4, 2, 24) ||
    !ARCADE_GAME_KINDS.includes(value.kind) ||
    !ARCADE_GAME_PRESETS.includes(value.preset) ||
    !ARCADE_GAME_THEMES.includes(value.theme) ||
    !ARCADE_GAME_DIFFICULTIES.includes(value.difficulty) ||
    !hasExactKeys(value.tuning, TUNING_KEYS) ||
    !validInteger(value.tuning.durationSeconds, 20, 90) ||
    !validInteger(value.tuning.speedPercent, 70, 140) ||
    !validInteger(value.tuning.targetScore, 1, 20) ||
    !validInteger(value.tuning.maxRounds, 1, 30) ||
    !isSafeArcadeDocument(value.document)
  ) return false;
  const preset = presetFor(value.preset);
  if (!preset || preset.kind !== value.kind) return false;
  if (value.preset === 'basketball-duel' && !isMobileBasketballDocument(value.document)) return false;
  return ![
    value.title, value.eyebrow, value.description, value.whyItFits, ...value.topics,
  ].some((text) => hasUnsafeText(text));
}

function normalizePayload(value, options) {
  if (!isArcadeGamePayload(value, options)) {
    const error = new Error('Arcade game did not match the safe arcade-v1 manifest');
    error.code = 'INVALID_ARCADE_GAME';
    error.status = 400;
    throw error;
  }
  return JSON.parse(JSON.stringify(value));
}

function tunedParams(preset, tuning) {
  const speedScale = tuning.speedPercent / 100;
  return {
    ...preset.params,
    durationMs: tuning.durationSeconds * 1_000,
    primarySpeed: Math.round(preset.params.primarySpeed * speedScale),
    secondarySpeed: Math.round(preset.params.secondarySpeed * speedScale),
    targetScore: tuning.targetScore,
    maxRounds: tuning.maxRounds,
  };
}

export function buildArcadeGameDefinition(payload, {
  id,
  matchId,
  gameType = '专属小游戏',
  generatedBy = 'fallback',
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalized = normalizePayload(payload);
  const preset = presetFor(normalized.preset);
  const artifactId = `artifact_${randomBytes(24).toString('base64url')}`;
  const codeHash = createHash('sha256').update(normalized.document).digest('hex');
  return {
    schemaVersion: ARCADE_GAME_SCHEMA_VERSION,
    engine: ARCADE_GAME_ENGINE,
    id,
    matchId,
    templateId: 'custom',
    seriesId: ARCADE_GAME_SERIES_ID,
    gameType,
    title: normalized.title,
    eyebrow: normalized.eyebrow,
    description: normalized.description,
    whyItFits: normalized.whyItFits,
    estimatedMinutes: normalized.estimatedMinutes,
    topics: normalized.topics,
    arcade: {
      kind: normalized.kind,
      preset: normalized.preset,
      theme: normalized.theme,
      difficulty: normalized.difficulty,
      params: tunedParams(preset, normalized.tuning),
      roles: preset.roles.map((role) => ({ ...role, controls: [...role.controls] })),
    },
    artifact: {
      artifactId,
      codeHash,
      document: normalized.document,
    },
    generatedBy,
    generatedAt,
  };
}

export function isArcadeGameDefinitionCandidate(value) {
  return isRecord(value) && (
    value.schemaVersion === ARCADE_GAME_SCHEMA_VERSION ||
    value.engine === ARCADE_GAME_ENGINE ||
    value.arcade !== undefined
  );
}

export function assertArcadeGameDefinition(value, { hasUnsafeText = () => false } = {}) {
  const invalid = () => {
    const error = new Error('Invalid safe arcade-v1 game definition');
    error.code = 'INVALID_ARCADE_GAME';
    error.status = 400;
    throw error;
  };
  if (
    !hasExactKeys(value, DEFINITION_KEYS) ||
    value.schemaVersion !== ARCADE_GAME_SCHEMA_VERSION ||
    value.engine !== ARCADE_GAME_ENGINE ||
    value.templateId !== 'custom' ||
    value.seriesId !== ARCADE_GAME_SERIES_ID ||
    !validString(value.id, 2, 200) ||
    !validString(value.matchId, 2, 200) ||
    !validString(value.gameType, 2, 60) ||
    !validString(value.title, 4, 60) ||
    !validString(value.eyebrow, 2, 30) ||
    !validString(value.description, 10, 200) ||
    !validString(value.whyItFits, 10, 200) ||
    !validInteger(value.estimatedMinutes, 1, 3) ||
    !validStrings(value.topics, 2, 4, 2, 24) ||
    !validString(value.generatedBy, 2, 30) ||
    !validString(value.generatedAt, 10, 50) ||
    !hasExactKeys(value.arcade, ARCADE_KEYS) ||
    !ARCADE_GAME_KINDS.includes(value.arcade.kind) ||
    !ARCADE_GAME_PRESETS.includes(value.arcade.preset) ||
    !ARCADE_GAME_THEMES.includes(value.arcade.theme) ||
    !ARCADE_GAME_DIFFICULTIES.includes(value.arcade.difficulty) ||
    !hasExactKeys(value.artifact, ARTIFACT_KEYS) ||
    !ARCADE_ARTIFACT_ID_PATTERN.test(value.artifact.artifactId) ||
    !ARCADE_CODE_HASH_PATTERN.test(value.artifact.codeHash) ||
    !isSafeArcadeDocument(value.artifact.document) ||
    createHash('sha256').update(value.artifact.document).digest('hex') !== value.artifact.codeHash
  ) invalid();
  const preset = presetFor(value.arcade.preset);
  if (!preset || preset.kind !== value.arcade.kind || !hasExactKeys(value.arcade.params, PARAM_KEYS)) invalid();
  for (const [key, [minimum, maximum]] of Object.entries(COMMON_PARAM_RANGES)) {
    if (!validInteger(value.arcade.params[key], minimum, maximum)) invalid();
  }
  if (!Array.isArray(value.arcade.roles) || value.arcade.roles.length !== 2) invalid();
  for (let index = 0; index < 2; index += 1) {
    const actual = value.arcade.roles[index];
    const expected = preset.roles[index];
    if (
      !hasExactKeys(actual, ROLE_KEYS) || actual.id !== expected.id || actual.label !== expected.label ||
      actual.objective !== expected.objective || !Array.isArray(actual.controls) ||
      actual.controls.length !== expected.controls.length ||
      actual.controls.some((control, controlIndex) => control !== expected.controls[controlIndex])
    ) invalid();
  }
  if ([
    value.gameType, value.title, value.eyebrow, value.description, value.whyItFits,
    ...value.topics,
  ].some((text) => hasUnsafeText(text))) invalid();
  return JSON.parse(JSON.stringify(value));
}

export function isArcadeGameDefinition(value, options = {}) {
  try {
    assertArcadeGameDefinition(value, options);
    return true;
  } catch {
    return false;
  }
}

export const FALLBACK_ARCADE_DOCUMENT = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>PairPlay 双人游戏</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101425;color:#fff;font-family:system-ui,sans-serif}main{height:100%;min-height:0;display:grid;grid-template-rows:minmax(0,1fr) auto;gap:8px;padding:8px 8px max(8px,env(safe-area-inset-bottom))}canvas{display:block;width:100%;height:100%;min-height:0;border-radius:18px;background:linear-gradient(#ffb36b,#7656d6);touch-action:none}.controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:end;gap:8px;min-height:58px;padding-bottom:1px}.controls label{display:grid;gap:3px;min-width:0;color:#dcd9f1;font-size:11px;font-weight:800}.controls output{color:#fff}.controls button,.controls input{width:100%;min-width:0;min-height:48px;border:0;border-radius:15px;font:800 15px system-ui;touch-action:none}.controls button{padding:0 14px;background:#fff;color:#27233d}.controls[data-role=shooter] button{grid-column:1/-1}.controls input{height:48px;accent-color:#ff8f55}.status{position:absolute;z-index:2;left:18px;top:16px;max-width:calc(100% - 36px);padding:7px 11px;border-radius:99px;background:#111b;font-size:13px;font-weight:800}button:active{transform:scale(.97)}button:disabled,input:disabled{opacity:.48}@media(max-width:520px){main{height:100dvh}.controls{position:relative;z-index:3}.controls button{min-height:54px;font-size:16px}}</style></head>
<body><main><canvas id="stage" width="1000" height="600" aria-label="双人游戏画面"></canvas><div class="controls" id="controls"></div></main><div class="status" id="status">等待连接</div><script>
'use strict';(()=>{const stage=document.getElementById('stage'),ctx=stage.getContext('2d'),controls=document.getElementById('controls'),status=document.getElementById('status');let channel='',role='',mode='basketball-duel',playMode='network',state=null,completed=false,paused=false,lastAt=0,previewStartedAt=0,aiAt=0,aimValue=0,powerValue=.76,moveValue=0,dragPointer=null;
const send=(type,extra={})=>{if(channel)parent.postMessage({pairplay:1,type,channel,...extra},'*')};
const resetBall=f=>{f.ball={x:110,y:500,vx:0,vy:0,inFlight:false}};
function previewState(){const duration=45000;return{phase:'playing',frame:mode==='basketball-duel'?{tick:0,remainingMs:duration,ball:{x:110,y:500,vx:0,vy:0,inFlight:false},hoop:{x:760,y:300},score:{shooter:0,keeper:0},shots:{taken:0,made:0},event:'preview-start'}:{tick:0,remainingMs:duration,score:{primary:0,secondary:0,team:0},event:'preview-start'},outcome:null}}
function launch(target){const f=state.frame;if(f.ball.inFlight)return;if(Number.isFinite(target)){const flight=1.05;f.ball.vx=(target-f.ball.x)/flight;f.ball.vy=(f.hoop.y-f.ball.y-.5*980*flight*flight)/flight}else{const speed=520+powerValue*300,angle=-1.04+aimValue*.34;f.ball.vx=Math.cos(angle)*speed;f.ball.vy=Math.sin(angle)*speed}f.ball.inFlight=true;f.shots.taken+=1;f.event='shot'}
function applyPreview(control,value){if(!state||state.phase!=='playing')return;const f=state.frame;if(mode==='basketball-duel'){if(control==='aim')aimValue=Math.max(-1,Math.min(1,Number(value)||0));else if(control==='power')powerValue=Math.max(.25,Math.min(1,Number(value)||0));else if(control==='move'&&role==='keeper')moveValue=Math.max(-1,Math.min(1,Number(value)||0));else if(control==='shoot'&&role==='shooter')launch()}else{const amount=control==='move'||control==='select'?1:2;if(mode==='tandem-rescue'||mode==='relic-expedition')f.score.team=Math.min(10,f.score.team+amount);else f.score.primary=Math.min(10,f.score.primary+amount);f.event=control}}
const input=(control,value)=>{if(paused)return;send('game.input',{control,value});if(playMode==='preview')applyPreview(control,value)};
function setPaused(next){paused=Boolean(next);for(const item of controls.querySelectorAll('button,input'))item.disabled=paused;controls.setAttribute('aria-disabled',String(paused))}
function button(label,down,up){const b=document.createElement('button');let activePointer=null;b.type='button';b.textContent=label;b.addEventListener('pointerdown',e=>{if(paused)return;e.preventDefault();activePointer=e.pointerId;b.setPointerCapture(e.pointerId);down()});if(up){const release=e=>{if(activePointer!==e.pointerId)return;activePointer=null;up();if(b.hasPointerCapture(e.pointerId))b.releasePointerCapture(e.pointerId)};b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release)}controls.appendChild(b);return b}
function slider(labelText,name,min,max,step,value,onChange){const label=document.createElement('label'),text=document.createElement('span'),output=document.createElement('output'),range=document.createElement('input');text.textContent=labelText;output.textContent=String(value);text.append(' ',output);range.type='range';range.min=String(min);range.max=String(max);range.step=String(step);range.value=String(value);range.setAttribute('aria-label',labelText);range.addEventListener('input',()=>{output.textContent=range.value;onChange(Number(range.value))});label.append(text,range);controls.appendChild(label)}
function mount(){controls.replaceChildren();controls.dataset.role=role;if(mode==='basketball-duel'&&role==='shooter'){slider('投篮角度','aim',-1,1,.02,aimValue,value=>{aimValue=value;input('aim',value)});slider('投篮力度','power',.25,1,.02,powerValue,value=>{powerValue=value;input('power',value)});button('点击投篮',()=>input('shoot',1))}else if(mode==='basketball-duel'){button('按住向左',()=>input('move',-1),()=>input('move',0));button('按住向右',()=>input('move',1),()=>input('move',0))}else{button('按住移动',()=>input('move',1),()=>input('move',0));button('行动',()=>input(role.includes('commander')?'commit':role.includes('runner')?'boost':role==='pilot'||role==='navigator'?'sync':role==='explorer'?'jump':'guard',1))}setPaused(paused)}
function keeperPointerMove(event){if(mode!=='basketball-duel'||role!=='keeper'||paused||dragPointer!==event.pointerId||!state||!state.frame||!state.frame.hoop)return;event.preventDefault();const rect=stage.getBoundingClientRect(),target=(event.clientX-rect.left)/Math.max(1,rect.width)*stage.width,current=Number(state.frame.hoop.x)||stage.width/2,distance=target-current;input('move',Math.abs(distance)<22?0:distance<0?-1:1)}
stage.addEventListener('pointerdown',event=>{if(mode!=='basketball-duel'||role!=='keeper'||paused)return;dragPointer=event.pointerId;stage.setPointerCapture(event.pointerId);keeperPointerMove(event)});stage.addEventListener('pointermove',keeperPointerMove);for(const name of ['pointerup','pointercancel'])stage.addEventListener(name,event=>{if(dragPointer!==event.pointerId)return;input('move',0);dragPointer=null;if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId)});
function advancePreview(now){if(playMode!=='preview'||paused||!state||state.phase!=='playing')return;const f=state.frame,dt=Math.min(.05,Math.max(0,(now-lastAt)/1000));f.tick+=1;f.remainingMs=Math.max(0,45000-(now-previewStartedAt));if(mode==='basketball-duel'){if(role==='shooter'){f.hoop.x=535+Math.sin(now/620)*300}else{f.hoop.x=Math.max(170,Math.min(900,f.hoop.x+moveValue*420*dt));if(now-aiAt>1650&&!f.ball.inFlight){aiAt=now;launch(f.hoop.x+(Math.random()-.5)*150)}}if(f.ball.inFlight){const oldY=f.ball.y;f.ball.x+=f.ball.vx*dt;f.ball.y+=f.ball.vy*dt;f.ball.vy+=980*dt;if(oldY<=f.hoop.y&&f.ball.y>=f.hoop.y&&Math.abs(f.ball.x-f.hoop.x)<72){f.score.shooter+=1;f.shots.made+=1;f.event='score';resetBall(f)}else if(f.ball.y>620||f.ball.x>1040||f.ball.x<0){f.score.keeper+=1;f.event='miss';resetBall(f)}}}else if(now-aiAt>1400){aiAt=now;if(mode==='tandem-rescue'||mode==='relic-expedition')f.score.team=Math.min(10,f.score.team+1);else f.score.secondary=Math.min(10,f.score.secondary+1)}if(f.remainingMs<=0){state.phase='finished';state.outcome={reason:'preview-ended',completedAt:Date.now(),score:{...f.score}}}}
function draw(now=0){requestAnimationFrame(draw);if(!lastAt)lastAt=now;advancePreview(now);lastAt=now;const w=stage.width,h=stage.height;ctx.clearRect(0,0,w,h);const f=state&&state.frame;if(!f){ctx.fillStyle='#fff';ctx.font='700 30px system-ui';ctx.textAlign='center';ctx.fillText('正在启动游戏',w/2,h/2);return}if(mode==='basketball-duel'&&f.ball&&f.hoop){ctx.fillStyle='#ffffff22';ctx.fillRect(0,h*.82,w,h*.18);ctx.strokeStyle='#fff';ctx.lineWidth=12;ctx.beginPath();ctx.moveTo(f.hoop.x-66,f.hoop.y);ctx.lineTo(f.hoop.x+66,f.hoop.y);ctx.stroke();ctx.fillStyle='#ff7c3b';ctx.beginPath();ctx.arc(f.ball.x,f.ball.y,14,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.font='800 30px system-ui';ctx.textAlign='center';ctx.fillText('投篮 '+f.score.shooter+' : '+f.score.keeper+' 篮筐',w/2,48)}else{ctx.fillStyle='#ffffff18';ctx.fillRect(70,210,w-140,90);const score=f.score||{};const progress=Math.max(score.primary||0,score.secondary||0,score.team||0);ctx.fillStyle='#72f2c5';ctx.fillRect(70,210,(w-140)*Math.min(1,progress/10),90);ctx.fillStyle='#fff';ctx.font='800 34px system-ui';ctx.textAlign='center';ctx.fillText('协作 / 对抗进度 '+progress,w/2,170)}status.textContent=(playMode==='preview'?'试玩 · ':'联机 · ')+(state.phase||'waiting')+' · '+Math.ceil((f.remainingMs||0)/1000)+'s';if(state.phase==='finished'&&!completed){completed=true;send('game.complete',{result:state.outcome||{}})}}
addEventListener('message',event=>{if(event.source!==parent||!event.data||event.data.pairplay!==1)return;const data=event.data;if(data.type==='host.init'){channel=String(data.channel||'');role=String(data.role||'shooter');mode=String(data.mode||mode);playMode=data.playMode==='preview'||!data.state?'preview':'network';state=playMode==='preview'?previewState():data.state||null;paused=Boolean(data.paused);previewStartedAt=performance.now();lastAt=previewStartedAt;aiAt=previewStartedAt;mount();send('game.ready')}else if(channel&&data.channel===channel&&data.type==='host.sync'){if(data.playMode==='network')playMode='network';if(playMode==='network')state=data.state||state;setPaused(data.paused)}else if(channel&&data.channel===channel&&data.type==='host.pause'){setPaused(true)}else if(channel&&data.channel===channel&&data.type==='host.resume'){setPaused(false)}else if(channel&&data.channel===channel&&data.type==='host.stop'){setPaused(true);state={...(state||{}),phase:'finished'}}});
addEventListener('error',event=>send('game.error',{message:String(event.message||'runtime error').slice(0,160)}));parent.postMessage({pairplay:1,type:'game.bootstrap-ready'},'*');draw()})();
</script></body></html>`;

function fallbackDocumentForPreset(presetId) {
  return FALLBACK_ARCADE_DOCUMENT.replace(
    "mode='basketball-duel'",
    `mode='${presetId}'`,
  );
}

const FALLBACK_COPY = Object.freeze({
  'basketball-duel': Object.freeze({ whyItFits: '从你们想玩的运动主题出发，用真正的双人操控把聊天变成一次轻量攻防。', theme: 'sunset' }),
  'dash-duel': Object.freeze({ whyItFits: '适合想来一点有胜负但节奏轻松的即时对抗，双方都有独立操作空间。', theme: 'neon' }),
  'tandem-rescue': Object.freeze({ whyItFits: '适合用同步操作完成同一个目标，让配合本身成为自然的破冰话题。', theme: 'ocean' }),
  'relic-expedition': Object.freeze({ whyItFits: '把共同探索变成一段短冒险，双方承担不同职责并一起推进。', theme: 'forest' }),
  'grid-command': Object.freeze({ whyItFits: '适合喜欢观察和预判的两个人，用短回合策略产生有来有回的互动。', theme: 'cosmos' }),
});

export function arcadePresetForPrompt(prompt) {
  const text = typeof prompt === 'string' ? prompt : '';
  if (/(?:篮球|投篮|篮筐|三分|球场)/u.test(text)) return 'basketball-duel';
  if (/(?:合作|协作|配合|共同|同步|双人闯关|救援)/u.test(text)) return 'tandem-rescue';
  if (/(?:冒险|探险|闯关|遗迹|迷宫|探索)/u.test(text)) return 'relic-expedition';
  if (/(?:策略|战术|棋|九宫格|塔防|经营|资源)/u.test(text)) return 'grid-command';
  if (/(?:对抗|竞技|竞速|比赛|决斗|冲线)/u.test(text)) return 'dash-duel';
  return 'basketball-duel';
}

export function buildArcadeFallbackGame(match, gameType = '专属小游戏', { prompt = '' } = {}) {
  const presetId = arcadePresetForPrompt(prompt);
  const preset = presetFor(presetId);
  const copy = FALLBACK_COPY[presetId];
  return buildArcadeGameDefinition({
    title: preset.title,
    eyebrow: preset.eyebrow,
    description: preset.description,
    whyItFits: copy.whyItFits,
    estimatedMinutes: Math.max(1, Math.min(3, Math.ceil(preset.params.durationMs / 60_000))),
    topics: [...preset.topics],
    kind: preset.kind,
    preset: presetId,
    theme: copy.theme,
    difficulty: 'normal',
    tuning: {
      durationSeconds: Math.round(preset.params.durationMs / 1_000),
      speedPercent: 100,
      targetScore: preset.params.targetScore,
      maxRounds: preset.params.maxRounds,
    },
    document: fallbackDocumentForPreset(presetId),
  }, {
    id: `arcade-${String(match?.match_id ?? 'match').slice(0, 120)}`,
    matchId: String(match?.match_id ?? 'match'),
    gameType,
    generatedBy: 'fallback',
  });
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function initialBasketballFrame(params) {
  return {
    tick: 0,
    remainingMs: params.durationMs,
    ball: {
      x: Math.round(params.arenaWidth * 0.18),
      y: params.arenaHeight - 58,
      vx: 0,
      vy: 0,
      inFlight: false,
    },
    hoop: {
      x: Math.round(params.arenaWidth * 0.68),
      y: Math.round(params.arenaHeight * 0.34),
    },
    score: { shooter: 0, keeper: 0 },
    shots: { taken: 0, made: 0 },
    event: null,
  };
}

function initialGenericFrame(params) {
  return {
    tick: 0,
    remainingMs: params.durationMs,
    score: { primary: 0, secondary: 0, team: 0 },
    round: 1,
    event: null,
  };
}

export function createArcadeSession(definition, participantIds, creatorId, timestamp) {
  assertArcadeGameDefinition(definition);
  if (!Array.isArray(participantIds) || participantIds.length !== 2 || new Set(participantIds).size !== 2) {
    throw new TypeError('Arcade session requires exactly two participants');
  }
  const ordered = [creatorId, ...participantIds.filter((id) => id !== creatorId)];
  if (ordered.length !== 2 || !participantIds.includes(creatorId)) {
    throw new TypeError('Arcade creator must belong to the room');
  }
  const assignments = Object.fromEntries(ordered.map((participantId, index) => [
    participantId,
    definition.arcade.roles[index].id,
  ]));
  const readyByParticipant = Object.fromEntries(participantIds.map((participantId) => [participantId, false]));
  const lastSeqByParticipant = Object.fromEntries(participantIds.map((participantId) => [participantId, -1]));
  return {
    stateVersion: 1,
    phase: 'waiting',
    assignments,
    readyByParticipant,
    lastSeqByParticipant,
    inputsByParticipant: Object.fromEntries(participantIds.map((participantId) => [participantId, {}])),
    lastContinuousAtByParticipant: {},
    eventCursor: 0,
    events: [],
    startedAt: null,
    countdownEndsAt: null,
    deadlineAt: null,
    lastFrameAt: timestamp,
    frame: definition.arcade.preset === 'basketball-duel'
      ? initialBasketballFrame(definition.arcade.params)
      : initialGenericFrame(definition.arcade.params),
    outcome: null,
    generic: {
      lastSyncAtByParticipant: {},
      selectedByParticipant: {},
      committedByParticipant: {},
    },
  };
}

function roleFor(definition, session, participantId) {
  const roleId = session.assignments?.[participantId];
  return definition.arcade.roles.find((role) => role.id === roleId) ?? null;
}

function basketballResetBall(frame, params) {
  frame.ball = {
    x: Math.round(params.arenaWidth * 0.18),
    y: params.arenaHeight - 58,
    vx: 0,
    vy: 0,
    inFlight: false,
  };
}

function completeSession(session, timestamp, reason) {
  if (session.phase === 'finished') return;
  session.phase = 'finished';
  session.frame.remainingMs = 0;
  session.outcome = {
    reason,
    completedAt: timestamp,
    score: clone(session.frame.score),
  };
}

function advanceBasketball(definition, session, timestamp) {
  const params = definition.arcade.params;
  if (session.phase === 'countdown' && timestamp >= session.countdownEndsAt) {
    session.phase = 'playing';
    session.startedAt = session.countdownEndsAt;
    session.deadlineAt = session.startedAt + params.durationMs;
    session.lastFrameAt = session.startedAt;
  }
  if (session.phase !== 'playing') return;
  const simulationEnd = Math.min(timestamp, session.deadlineAt);
  let cursor = session.lastFrameAt;
  const keeperId = Object.keys(session.assignments).find(
    (participantId) => session.assignments[participantId] === 'keeper',
  );
  const keeperMove = clamp(Number(session.inputsByParticipant?.[keeperId]?.move ?? 0), -1, 1);
  while (cursor + params.tickMs <= simulationEnd) {
    const stepMs = params.tickMs;
    const seconds = stepMs / 1_000;
    const frame = session.frame;
    frame.tick += 1;
    frame.event = null;
    frame.hoop.x = clamp(
      frame.hoop.x + keeperMove * params.secondarySpeed * seconds,
      params.targetSize / 2,
      params.arenaWidth - params.targetSize / 2,
    );
    if (frame.ball.inFlight) {
      const previousY = frame.ball.y;
      frame.ball.x += frame.ball.vx * seconds;
      frame.ball.y += frame.ball.vy * seconds + 0.5 * params.gravity * seconds * seconds;
      frame.ball.vy += params.gravity * seconds;
      const descendingThroughHoop = previousY < frame.hoop.y && frame.ball.y >= frame.hoop.y && frame.ball.vy > 0;
      if (
        descendingThroughHoop &&
        Math.abs(frame.ball.x - frame.hoop.x) <= params.targetSize / 2 - params.projectileRadius
      ) {
        frame.score.shooter += 1;
        frame.shots.made += 1;
        frame.event = { type: 'score', role: 'shooter' };
        basketballResetBall(frame, params);
      } else if (
        frame.ball.y > params.arenaHeight + params.projectileRadius ||
        frame.ball.x < -params.projectileRadius ||
        frame.ball.x > params.arenaWidth + params.projectileRadius
      ) {
        frame.score.keeper += 1;
        frame.event = { type: 'miss', role: 'keeper' };
        basketballResetBall(frame, params);
      }
    }
    cursor += stepMs;
  }
  if (simulationEnd === session.deadlineAt && cursor < simulationEnd) cursor = simulationEnd;
  session.lastFrameAt = cursor;
  session.frame.remainingMs = Math.max(0, session.deadlineAt - session.lastFrameAt);
  if (
    session.frame.score.shooter >= params.targetScore ||
    session.frame.score.keeper >= params.targetScore ||
    (session.frame.shots.taken >= params.maxRounds && !session.frame.ball.inFlight)
  ) completeSession(session, timestamp, 'score-limit');
  else if (timestamp >= session.deadlineAt) completeSession(session, timestamp, 'time-limit');
}

function advanceGeneric(definition, session, timestamp) {
  const params = definition.arcade.params;
  if (session.phase === 'countdown' && timestamp >= session.countdownEndsAt) {
    session.phase = 'playing';
    session.startedAt = session.countdownEndsAt;
    session.deadlineAt = session.startedAt + params.durationMs;
    session.lastFrameAt = session.startedAt;
  }
  if (session.phase !== 'playing') return;
  const elapsed = Math.max(0, Math.min(timestamp, session.deadlineAt) - session.lastFrameAt);
  const ticks = Math.floor(elapsed / params.tickMs);
  session.frame.tick += ticks;
  session.lastFrameAt += ticks * params.tickMs;
  if (timestamp >= session.deadlineAt) session.lastFrameAt = session.deadlineAt;
  session.frame.remainingMs = Math.max(0, session.deadlineAt - session.lastFrameAt);
  if (timestamp >= session.deadlineAt) completeSession(session, timestamp, 'time-limit');
}

export function advanceArcadeSession(definition, session, timestamp) {
  if (definition.arcade.preset === 'basketball-duel') advanceBasketball(definition, session, timestamp);
  else advanceGeneric(definition, session, timestamp);
  return session;
}

function numericControlValue(control, value) {
  if (control === 'power') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null;
    return value;
  }
  if (control === 'select') {
    if (!Number.isInteger(value) || value < 0 || value > 8) return null;
    return value;
  }
  if (['shoot', 'boost', 'sync', 'jump', 'guard', 'commit'].includes(control)) {
    if (value === undefined) return 1;
    if (value !== 0 && value !== 1) return null;
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) return null;
  return value;
}

const CONTINUOUS_CONTROLS = new Set(['move', 'aim', 'power']);

function lastContinuousControlAt(session, participantId, control) {
  const record = session.lastContinuousAtByParticipant?.[participantId];
  if (isRecord(record)) return record[control];
  // Compatibility with v4 sessions persisted before timestamps became per-control.
  return control === 'move' && Number.isFinite(record) ? record : null;
}

function markContinuousControl(session, participantId, control, timestamp) {
  const current = session.lastContinuousAtByParticipant?.[participantId];
  session.lastContinuousAtByParticipant[participantId] = {
    ...(isRecord(current) ? current : {}),
    [control]: timestamp,
  };
}

function genericInput(definition, session, participantId, role, control, value, timestamp) {
  const frame = session.frame;
  const participantIds = Object.keys(session.assignments);
  const actorIndex = participantIds.indexOf(participantId);
  const scoreKey = actorIndex === 0 ? 'primary' : 'secondary';
  if (definition.arcade.preset === 'dash-duel' && control === 'boost' && value === 1) {
    frame.score[scoreKey] += 1;
    frame.event = { type: 'boost', role: role.id };
  } else if (definition.arcade.preset === 'tandem-rescue' && control === 'sync' && value === 1) {
    session.generic.lastSyncAtByParticipant[participantId] = timestamp;
    const synchronized = participantIds.every((id) =>
      Number.isFinite(session.generic.lastSyncAtByParticipant[id]) &&
      Math.abs(timestamp - session.generic.lastSyncAtByParticipant[id]) <= 1_500,
    );
    if (synchronized) {
      frame.score.team += 1;
      frame.event = { type: 'sync', role: 'team' };
      session.generic.lastSyncAtByParticipant = {};
    }
  } else if (definition.arcade.preset === 'relic-expedition' && ['jump', 'guard'].includes(control) && value === 1) {
    frame.score[scoreKey] += 1;
    frame.score.team = Math.min(frame.score.primary, frame.score.secondary);
    frame.event = { type: control, role: role.id };
  } else if (definition.arcade.preset === 'grid-command') {
    if (control === 'select') session.generic.selectedByParticipant[participantId] = value;
    if (control === 'commit' && value === 1) {
      session.generic.committedByParticipant[participantId] = true;
      if (participantIds.every((id) => session.generic.committedByParticipant[id])) {
        const [left, right] = participantIds.map((id) => session.generic.selectedByParticipant[id]);
        if (Number.isInteger(left) && Number.isInteger(right)) {
          if (left === right) frame.score.team += 1;
          else frame.score[left > right ? 'primary' : 'secondary'] += 1;
          frame.event = { type: left === right ? 'draw' : 'claim', role: left === right ? 'team' : role.id };
          frame.round += 1;
        }
        session.generic.selectedByParticipant = {};
        session.generic.committedByParticipant = {};
      }
    }
  }
  const target = definition.arcade.params.targetScore;
  if (Math.max(frame.score.primary, frame.score.secondary, frame.score.team) >= target || frame.round > definition.arcade.params.maxRounds) {
    completeSession(session, timestamp, 'score-limit');
  }
}

/** Applies one authenticated, per-actor sequenced action to an invite-local session. */
export function applyArcadeAction(definition, session, participantId, input, timestamp) {
  if (!isRecord(session.lastContinuousAtByParticipant)) session.lastContinuousAtByParticipant = {};
  const role = roleFor(definition, session, participantId);
  if (!role) return { ok: false, code: 'WRONG_GAME_ROLE', message: 'Participant has no role in this arcade game', status: 403 };
  if (!Number.isSafeInteger(input?.seq) || input.seq < 0 || input.seq > 1_000_000_000) {
    return { ok: false, code: 'INVALID_ACTION', message: 'Arcade action seq must be a safe non-negative integer', status: 400 };
  }
  const lastSeq = session.lastSeqByParticipant[participantId];
  if (input.seq <= lastSeq) {
    return { ok: false, code: 'STALE_ACTION', message: 'Arcade action seq is stale', status: 409 };
  }
  advanceArcadeSession(definition, session, timestamp);
  if (session.phase === 'finished') {
    return { ok: false, code: 'GAME_COMPLETE', message: 'Arcade game is already complete', status: 409 };
  }
  let payload;
  if (input.type === 'arcade-ready') {
    if (session.readyByParticipant[participantId]) {
      return { ok: false, code: 'ALREADY_READY', message: 'Arcade player is already ready', status: 409 };
    }
    session.readyByParticipant[participantId] = true;
    payload = { seq: input.seq };
    if (Object.values(session.readyByParticipant).every(Boolean)) {
      session.phase = 'countdown';
      session.countdownEndsAt = timestamp + 1_000;
      session.lastFrameAt = session.countdownEndsAt;
    }
  } else if (input.type === 'arcade-tick') {
    payload = { seq: input.seq };
  } else if (input.type === 'arcade-input') {
    if (!['countdown', 'playing'].includes(session.phase)) {
      return { ok: false, code: 'GAME_NOT_READY', message: 'Both arcade players must be ready first', status: 409 };
    }
    if (typeof input.control !== 'string' || !role.controls.includes(input.control)) {
      return { ok: false, code: 'WRONG_GAME_ROLE', message: 'This control is not available to the current role', status: 403 };
    }
    const lastContinuousAt = lastContinuousControlAt(session, participantId, input.control);
    if (
      CONTINUOUS_CONTROLS.has(input.control) &&
      Number.isFinite(lastContinuousAt) &&
      timestamp - lastContinuousAt < 80
    ) {
      return { ok: false, code: 'ACTION_THROTTLED', message: 'Continuous arcade controls are limited to about 10 Hz', status: 429 };
    }
    const value = numericControlValue(input.control, input.value);
    if (value === null) {
      return { ok: false, code: 'INVALID_ACTION', message: 'Arcade control value is outside its safe range', status: 400 };
    }
    if (session.phase === 'countdown' && ['shoot', 'boost', 'sync', 'jump', 'guard', 'commit'].includes(input.control)) {
      return { ok: false, code: 'COUNTDOWN_ACTIVE', message: 'Wait for the arcade countdown to finish', status: 409 };
    }
    session.inputsByParticipant[participantId][input.control] = value;
    if (CONTINUOUS_CONTROLS.has(input.control)) {
      markContinuousControl(session, participantId, input.control, timestamp);
    }
    if (definition.arcade.preset === 'basketball-duel' && input.control === 'shoot' && value === 1) {
      const frame = session.frame;
      if (frame.ball.inFlight) {
        return { ok: false, code: 'SHOT_IN_FLIGHT', message: 'Wait for the current shot to finish', status: 409 };
      }
      if (frame.shots.taken >= definition.arcade.params.maxRounds) {
        return { ok: false, code: 'ROUND_LIMIT', message: 'No basketball shots remain', status: 409 };
      }
      const actorInputs = session.inputsByParticipant[participantId];
      const aim = clamp(Number(actorInputs.aim ?? 0), -1, 1);
      const power = clamp(Number(actorInputs.power ?? 0.72), 0, 1);
      frame.ball.vx = definition.arcade.params.primarySpeed * (0.52 + aim * 0.24);
      frame.ball.vy = -definition.arcade.params.primarySpeed * (0.9 + power * 0.36);
      frame.ball.inFlight = true;
      frame.shots.taken += 1;
      frame.event = { type: 'shot', role: 'shooter' };
    } else if (definition.arcade.preset !== 'basketball-duel') {
      genericInput(definition, session, participantId, role, input.control, value, timestamp);
    }
    payload = { seq: input.seq, control: input.control, value };
  } else {
    return { ok: false, code: 'INVALID_ACTION', message: 'Unsupported arcade action', status: 400 };
  }
  session.lastSeqByParticipant[participantId] = input.seq;
  if (input.type !== 'arcade-tick') {
    session.eventCursor = Number(session.eventCursor ?? 0) + 1;
    const event = {
      cursor: session.eventCursor,
      eventId: `event-${session.eventCursor}`,
      seq: input.seq,
      actorRole: role.id,
      type: input.type === 'arcade-ready' ? 'ready' : 'input',
      ...(payload.control ? { control: payload.control, value: payload.value } : {}),
      serverAt: timestamp,
    };
    if (!Array.isArray(session.events)) session.events = [];
    if (session.events.length >= 128) session.events.shift();
    session.events.push(event);
  }
  return { ok: true, payload, completed: session.phase === 'finished' };
}

/** Returns the player-specific view; internal assignments and peer inputs stay private. */
export function arcadeSessionProjection(definition, session, participantId) {
  const role = roleFor(definition, session, participantId);
  const peerId = Object.keys(session.assignments).find((id) => id !== participantId);
  const peerRole = roleFor(definition, session, peerId);
  const ownInputs = session.inputsByParticipant?.[participantId] ?? {};
  return {
    phase: session.phase,
    self: {
      role: role?.id ?? null,
      ready: Boolean(session.readyByParticipant?.[participantId]),
      controls: role ? [...role.controls] : [],
      seq: Number(session.lastSeqByParticipant?.[participantId] ?? -1),
      input: clone(ownInputs),
    },
    peer: {
      role: peerRole?.id ?? null,
      ready: Boolean(session.readyByParticipant?.[peerId]),
    },
    frame: clone(session.frame),
    events: clone(Array.isArray(session.events) ? session.events : []),
    eventCursor: Number(session.eventCursor ?? 0),
    countdownEndsAt: session.countdownEndsAt,
    startedAt: session.startedAt,
    deadlineAt: session.deadlineAt,
    outcome: clone(session.outcome),
  };
}
