import type {
  ArcadeCategory,
  ArcadeGameDefinition,
  ArcadeGameKind,
  ArcadeTheme,
} from './types';

export interface ArcadeGameDescriptor {
  kind: ArcadeGameKind;
  category: ArcadeCategory;
  label: string;
  description: string;
  roles: readonly [string, string];
  controls: readonly [string, string];
  defaultTheme: ArcadeTheme;
  defaultDurationSeconds: number;
  promptHints: readonly string[];
}

export const ARCADE_GAME_REGISTRY: Readonly<Record<ArcadeGameKind, ArcadeGameDescriptor>> = Object.freeze({
  'basketball-duel': Object.freeze<ArcadeGameDescriptor>({
    kind: 'basketball-duel',
    category: 'sport',
    label: '移动篮筐攻防',
    description: '一人调角度与力度投篮，另一人实时拖动篮筐。',
    roles: ['投手', '篮筐守门员'] as const,
    controls: ['拖动瞄准，按住蓄力后松手', '左右拖动篮筐'] as const,
    defaultTheme: { accent: 'coral', backdrop: 'court' },
    defaultDurationSeconds: 40,
    promptHints: ['篮球', '投篮', '球场', '运动', '对抗'],
  }),
  'neon-paddles': Object.freeze<ArcadeGameDescriptor>({
    kind: 'neon-paddles',
    category: 'competition',
    label: '霓虹弹球对抗',
    description: '双方各守一侧，拖动挡板把光球打回去。',
    roles: ['左侧守门员', '右侧守门员'] as const,
    controls: ['上下拖动左侧挡板', '上下拖动右侧挡板'] as const,
    defaultTheme: { accent: 'violet', backdrop: 'night' },
    defaultDurationSeconds: 45,
    promptHints: ['对抗', '竞技', '反应', '乒乓', '弹球'],
  }),
  'meteor-rescue': Object.freeze<ArcadeGameDescriptor>({
    kind: 'meteor-rescue',
    category: 'cooperation',
    label: '流星救援队',
    description: '一人驾驶收集星光，一人在危险时启动护盾。',
    roles: ['飞船驾驶员', '护盾工程师'] as const,
    controls: ['左右拖动飞船', '看准时机点击护盾'] as const,
    defaultTheme: { accent: 'blue', backdrop: 'space' },
    defaultDurationSeconds: 45,
    promptHints: ['合作', '宇宙', '救援', '飞船', '收集'],
  }),
  'ruins-relay': Object.freeze<ArcadeGameDescriptor>({
    kind: 'ruins-relay',
    category: 'adventure',
    label: '遗迹双人闯关',
    description: '一人奔跑跳跃，另一人切换前方桥梁，合力抵达终点。',
    roles: ['遗迹探险家', '机关向导'] as const,
    controls: ['左右移动与跳跃', '选择安全桥梁'] as const,
    defaultTheme: { accent: 'mint', backdrop: 'jungle' },
    defaultDurationSeconds: 50,
    promptHints: ['冒险', '闯关', '遗迹', '探险', '跑酷'],
  }),
  'signal-grid': Object.freeze<ArcadeGameDescriptor>({
    kind: 'signal-grid',
    category: 'strategy',
    label: '信号塔策略局',
    description: '轮流占领节点，率先连成一条信号链。',
    roles: ['珊瑚方指挥官', '蓝紫方指挥官'] as const,
    controls: ['轮到你时选择空节点', '轮到你时选择空节点'] as const,
    defaultTheme: { accent: 'gold', backdrop: 'tabletop' },
    defaultDurationSeconds: 60,
    promptHints: ['策略', '布局', '棋盘', '脑力', '回合'],
  }),
});

export const ARCADE_GAME_KINDS = Object.freeze(Object.keys(ARCADE_GAME_REGISTRY) as ArcadeGameKind[]);

const CATEGORY_FALLBACK: Record<ArcadeCategory, ArcadeGameKind> = {
  competition: 'neon-paddles',
  cooperation: 'meteor-rescue',
  sport: 'basketball-duel',
  adventure: 'ruins-relay',
  strategy: 'signal-grid',
};

const CATEGORY_ALIASES: Array<{ category: ArcadeCategory; pattern: RegExp }> = [
  { category: 'sport', pattern: /篮球|投篮|球场|运动|体育/u },
  { category: 'cooperation', pattern: /合作|协作|一起|救援|双人配合/u },
  { category: 'adventure', pattern: /冒险|闯关|探索|遗迹|跑酷/u },
  { category: 'strategy', pattern: /策略|棋盘|布局|塔防|脑力/u },
  { category: 'competition', pattern: /对抗|竞技|比赛|弹球|乒乓/u },
];

export function arcadeDescriptor(kind: ArcadeGameKind) {
  return ARCADE_GAME_REGISTRY[kind];
}

export function chooseArcadeKind(prompt: string, requestedCategory?: ArcadeCategory): ArcadeGameKind {
  const normalized = prompt.slice(0, 2_000);
  const exact = ARCADE_GAME_KINDS.find((kind) => (
    ARCADE_GAME_REGISTRY[kind].promptHints.some((hint) => normalized.includes(hint))
  ));
  if (exact) return exact;
  const inferredCategory = CATEGORY_ALIASES.find(({ pattern }) => pattern.test(normalized))?.category;
  return CATEGORY_FALLBACK[requestedCategory ?? inferredCategory ?? 'cooperation'];
}

const THEMES = new Set<ArcadeTheme['accent']>(['coral', 'violet', 'mint', 'gold', 'blue']);
const BACKDROPS = new Set<ArcadeTheme['backdrop']>(['court', 'night', 'space', 'jungle', 'tabletop']);

function shortText(value: unknown, fallback: string, maximum: number) {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().replace(/[\r\n\t]+/gu, ' ').slice(0, maximum);
  return text || fallback;
}

/** Safely turns AI/fallback JSON into a runnable registry definition. */
export function normalizeArcadeDefinition(value: unknown): ArcadeGameDefinition {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const kind = typeof input.kind === 'string' && ARCADE_GAME_KINDS.includes(input.kind as ArcadeGameKind)
    ? input.kind as ArcadeGameKind
    : chooseArcadeKind(shortText(input.title, '', 80));
  const descriptor = ARCADE_GAME_REGISTRY[kind];
  const rawTheme = input.theme && typeof input.theme === 'object' ? input.theme as Record<string, unknown> : {};
  const accent = typeof rawTheme.accent === 'string' && THEMES.has(rawTheme.accent as ArcadeTheme['accent'])
    ? rawTheme.accent as ArcadeTheme['accent']
    : descriptor.defaultTheme.accent;
  const backdrop = typeof rawTheme.backdrop === 'string' && BACKDROPS.has(rawTheme.backdrop as ArcadeTheme['backdrop'])
    ? rawTheme.backdrop as ArcadeTheme['backdrop']
    : descriptor.defaultTheme.backdrop;
  const rawTopics = Array.isArray(input.topicTokens) ? input.topicTokens : [];
  const topicTokens = rawTopics
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().replace(/[\r\n\t]/gu, ' ').slice(0, 10))
    .filter(Boolean)
    .slice(0, 5);
  const rawDuration = typeof input.durationSeconds === 'number' ? input.durationSeconds : descriptor.defaultDurationSeconds;
  const rawSeed = typeof input.seed === 'number' && Number.isFinite(input.seed) ? input.seed : 20260823;
  return {
    schemaVersion: 1,
    engine: 'arcade-v1',
    kind,
    category: descriptor.category,
    title: shortText(input.title, descriptor.label, 36),
    subtitle: shortText(input.subtitle, descriptor.description, 80),
    durationSeconds: Math.round(Math.max(20, Math.min(90, rawDuration))),
    seed: Math.abs(Math.trunc(rawSeed)) % 2_147_483_647,
    theme: { accent, backdrop },
    topicTokens,
  };
}

export function buildArcadeDefinition(
  prompt: string,
  options: Partial<Pick<ArcadeGameDefinition, 'title' | 'subtitle' | 'seed' | 'topicTokens'>> & {
    category?: ArcadeCategory;
    kind?: ArcadeGameKind;
  } = {},
): ArcadeGameDefinition {
  const kind = options.kind ?? chooseArcadeKind(prompt, options.category);
  const descriptor = arcadeDescriptor(kind);
  return normalizeArcadeDefinition({
    kind,
    title: options.title ?? descriptor.label,
    subtitle: options.subtitle ?? descriptor.description,
    seed: options.seed,
    topicTokens: options.topicTokens,
    theme: descriptor.defaultTheme,
    durationSeconds: descriptor.defaultDurationSeconds,
  });
}

const SERVER_PRESET_FALLBACK: Record<string, ArcadeGameKind> = {
  'dash-duel': 'neon-paddles',
  'tandem-rescue': 'meteor-rescue',
  'basketball-duel': 'basketball-duel',
  'relic-expedition': 'ruins-relay',
  'grid-command': 'signal-grid',
};

const SERVER_THEME_FALLBACK: Record<string, ArcadeTheme> = {
  sunset: { accent: 'coral', backdrop: 'court' },
  neon: { accent: 'violet', backdrop: 'night' },
  forest: { accent: 'mint', backdrop: 'jungle' },
  ocean: { accent: 'blue', backdrop: 'space' },
  cosmos: { accent: 'gold', backdrop: 'tabletop' },
};

/** Builds the client-owned playable fallback from a public schema-v4 manifest. */
export function arcadeFallbackFromServerDefinition(value: unknown): ArcadeGameDefinition | null {
  if (!value || typeof value !== 'object') return null;
  const definition = value as Record<string, unknown>;
  if (definition.schemaVersion !== 4 || definition.engine !== 'arcade-v1') return null;
  const arcade = definition.arcade && typeof definition.arcade === 'object'
    ? definition.arcade as Record<string, unknown>
    : null;
  if (!arcade || typeof arcade.preset !== 'string') return null;
  const kind = SERVER_PRESET_FALLBACK[arcade.preset];
  if (!kind) return null;
  const params = arcade.params && typeof arcade.params === 'object' ? arcade.params as Record<string, unknown> : {};
  const artifact = definition.artifact && typeof definition.artifact === 'object' ? definition.artifact as Record<string, unknown> : {};
  const codeHashSeed = typeof artifact.codeHash === 'string' && /^[a-f0-9]{8,64}$/u.test(artifact.codeHash)
    ? Number.parseInt(artifact.codeHash.slice(0, 8), 16)
    : 2_026_082_3;
  return normalizeArcadeDefinition({
    kind,
    title: definition.title,
    subtitle: definition.description,
    durationSeconds: typeof params.durationMs === 'number' ? params.durationMs / 1_000 : undefined,
    seed: codeHashSeed,
    theme: typeof arcade.theme === 'string' ? SERVER_THEME_FALLBACK[arcade.theme] : undefined,
    topicTokens: definition.topics,
  });
}
