import { useEffect, useState } from 'react';
import './admin.css';

interface AdminSession { authenticated: boolean; csrfToken?: string; }
interface AdminConfig { apiBaseUrl: string; apiKeyConfigured: boolean; model: string; imageApiBaseUrl: string; imageApiRoute: string; imageApiKeyConfigured: boolean; imageProtocol: 'ark:image-generations' | 'openai:image-generations'; imageModel: string; systemPrompt: string; gameTypes: AdminGameType[]; updatedAt: string | null; }
interface AdminGameType { id: 'profile-riddle' | 'keyword-wheel' | 'rapid-choice' | 'custom'; label: string; enabled: boolean; generationPrompt: string; }
interface ApiErrorBody { error?: string; code?: string; }

class ApiRequestError extends Error { status: number; constructor(message: string, status: number) { super(message); this.name = 'ApiRequestError'; this.status = status; } }
async function readApi<T>(response: Response): Promise<T> { const payload = (await response.json().catch(() => ({}))) as T & ApiErrorBody; if (!response.ok) throw new ApiRequestError(payload.error ?? `请求失败（${response.status}）`, response.status); return payload; }
function formatUpdatedAt(value: string | null) { if (!value) return '尚未保存'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }); }

type AdminSection = 'overview' | 'provider' | 'game-types' | 'prompt';
const sections: Array<{ id: AdminSection; path: string; label: string; caption: string; icon: string }> = [
  { id: 'overview', path: '/admin', label: '总览', caption: '查看控制台状态', icon: '⌂' },
  { id: 'provider', path: '/admin/provider', label: '模型接口', caption: 'API 与模型配置', icon: '✦' },
  { id: 'game-types', path: '/admin/game-types', label: '游戏模板', caption: '玩法与滚动关键词', icon: '◇' },
  { id: 'prompt', path: '/admin/prompt', label: '系统提示词', caption: '统一生成规则', icon: '⌘' },
];
function sectionFromPath(pathname: string): AdminSection { return sections.find((item) => item.path === pathname)?.id ?? 'overview'; }

type BusyState = 'login' | 'save' | 'models' | 'logout' | null;

export default function AdminPage() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [password, setPassword] = useState('');
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [imageApiBaseUrl, setImageApiBaseUrl] = useState('https://tokendance.space/gateway/ark/v3');
  const [imageApiRoute, setImageApiRoute] = useState('/images/generations');
  const [imageApiKey, setImageApiKey] = useState('');
  const [imageProtocol, setImageProtocol] = useState<AdminConfig['imageProtocol']>('ark:image-generations');
  const [imageModel, setImageModel] = useState('seedream-5.0-pro');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [gameTypes, setGameTypes] = useState<AdminGameType[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<BusyState>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<AdminSection>(() => sectionFromPath(window.location.pathname));

  function navigate(path: string) {
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
    setActiveSection(sectionFromPath(path));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  useEffect(() => { const onPopState = () => setActiveSection(sectionFromPath(window.location.pathname)); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState); }, []);

  function applyConfig(next: AdminConfig) { setConfig(next); setApiBaseUrl(next.apiBaseUrl); setModel(next.model); setImageApiBaseUrl(next.imageApiBaseUrl ?? 'https://tokendance.space/gateway/ark/v3'); setImageApiRoute(next.imageApiRoute ?? '/images/generations'); setImageProtocol(next.imageProtocol ?? 'ark:image-generations'); setImageModel(next.imageModel ?? 'seedream-5.0-pro'); setSystemPrompt(next.systemPrompt); setGameTypes(next.gameTypes.map((item) => ({ ...item }))); }
  async function loadConfig() { const response = await fetch('/api/admin/config', { credentials: 'same-origin' }); applyConfig(await readApi<AdminConfig>(response)); setPageError(null); }
  function handleFailure(error: unknown, fallback: string) { const message = error instanceof Error ? error.message : fallback; if (error instanceof ApiRequestError && error.status === 401) { setSession({ authenticated: false }); setConfig(null); setNotice({ tone: 'error', text: '管理会话已过期，请重新登录。' }); return; } setNotice({ tone: 'error', text: message }); }

  useEffect(() => {
    let active = true; let sessionWasAuthenticated = false;
    void fetch('/api/admin/session', { credentials: 'same-origin' }).then((response) => readApi<AdminSession>(response)).then(async (nextSession) => { if (!active) return; sessionWasAuthenticated = nextSession.authenticated; setSession(nextSession); if (nextSession.authenticated) await loadConfig(); }).catch((error: Error) => { if (!active) return; if (sessionWasAuthenticated) setPageError(error.message); else { setSession({ authenticated: false }); setNotice({ tone: 'error', text: error.message }); } });
    return () => { active = false; };
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy('login'); setNotice(null); let loginEstablished = false;
    try {
      const response = await fetch('/api/admin/session', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const nextSession = await readApi<AdminSession>(response); loginEstablished = nextSession.authenticated; setSession(nextSession); setPassword(''); await loadConfig(); setNotice({ tone: 'success', text: '已安全登录管理控制台。' });
    } catch (error) { if (loginEstablished && !(error instanceof ApiRequestError && error.status === 401)) setPageError(error instanceof Error ? error.message : '无法读取配置'); else handleFailure(error, '登录失败'); } finally { setBusy(null); }
  }

  async function saveConfig(options: { clearApiKey?: boolean; clearImageApiKey?: boolean } = {}) {
    if (!session?.csrfToken) return;
    if (!gameTypes.some((item) => item.enabled)) { setNotice({ tone: 'error', text: '至少保留一种启用中的游戏类型。' }); return; }
    setBusy('save'); setNotice(null);
    try {
      const response = await fetch('/api/admin/config', { method: 'PUT', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }, body: JSON.stringify({ apiBaseUrl, apiKey, clearApiKey: options.clearApiKey === true, model, imageApiBaseUrl, imageApiRoute, imageApiKey, clearImageApiKey: options.clearImageApiKey === true, imageProtocol, imageModel, systemPrompt, gameTypes }) });
      const next = await readApi<AdminConfig>(response); applyConfig(next); setApiKey(''); setImageApiKey(''); setModels([]); setNotice({ tone: 'success', text: options.clearApiKey ? '文本模型 Key 已清除，前台将使用安全题卡。' : options.clearImageApiKey ? '生图 Key 已清除，结果卡将保留文字样式。' : '配置已加密保存，修改立即生效。' });
    } catch (error) { handleFailure(error, '保存失败'); } finally { setBusy(null); }
  }

  async function loadModels() {
    if (!session?.csrfToken) return; setBusy('models'); setNotice({ tone: 'info', text: '正在使用已保存的 Key 读取可用模型…' });
    try { const response = await fetch('/api/admin/models', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }, body: '{}' }); const payload = await readApi<{ models: string[] }>(response); setModels(payload.models); setNotice({ tone: 'success', text: `连接成功，当前 Key 可见 ${payload.models.length} 个模型。` }); } catch (error) { handleFailure(error, '连接失败'); } finally { setBusy(null); }
  }

  async function logout() {
    if (!session?.csrfToken) return; setBusy('logout');
    try { await readApi(await fetch('/api/admin/session', { method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }, body: '{}' })); setSession({ authenticated: false }); setConfig(null); setNotice({ tone: 'info', text: '已退出管理控制台。' }); } catch (error) { handleFailure(error, '退出失败，请重试'); } finally { setBusy(null); }
  }

  if (session === null) return <main className="admin-loading"><span>良</span><p>正在确认管理会话…</p></main>;

  if (!session.authenticated) return (
    <main className="admin-login-shell">
      <a className="admin-back-link" href="/">← 返回聊天演示</a>
      <form className="admin-login-card" onSubmit={login}>
        <div className="admin-brand-mark">良</div><h1>专属游戏控制台</h1>
        <input type="hidden" name="username" autoComplete="username" value="admin" readOnly />
        <label className="admin-field"><span>管理员密码</span><input type="password" name="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入独立管理密码" required /></label>
        {notice && <p className={`admin-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
        <button className="admin-primary-button" type="submit" disabled={busy === 'login'}>{busy === 'login' ? '正在验证…' : '进入控制台'}</button>
      </form>
    </main>
  );

  if (!config) return <main className="admin-loading"><span>良</span><p>{pageError ?? '正在读取 AI 配置…'}</p>{pageError && <button className="admin-primary-button" type="button" onClick={() => { setPageError(null); void loadConfig().catch((error) => setPageError(error instanceof Error ? error.message : '重试失败')); }}>重新读取配置</button>}</main>;

  const current = sections.find((item) => item.id === activeSection) ?? sections[0];
  const saveLabel = busy === 'save' ? '正在保存…' : '保存并立即生效';
  return (
    <main className="admin-page">
      <aside className="admin-sidebar">
        <a className="admin-wordmark" href="/"><span>良</span><strong>Pair Playground</strong></a>
        <div className="admin-sidebar__label">控制台目录</div>
        <nav className="admin-nav" aria-label="控制台功能区">
          {sections.map((item) => <a key={item.id} href={item.path} className={`admin-nav-item ${activeSection === item.id ? 'is-active' : ''}`} onClick={(event) => { event.preventDefault(); navigate(item.path); }}><span className="admin-nav-item__icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.caption}</small></span>{activeSection === item.id && <i aria-hidden="true">›</i>}</a>)}
        </nav>
        <div className="admin-sidebar__footer"><div className="admin-sidebar-status"><span className={config.apiKeyConfigured ? 'is-online' : 'is-offline'} /><span><strong>{config.apiKeyConfigured ? 'AI 已连接' : '使用本地题卡'}</strong><small>{config.apiKeyConfigured ? config.model : '尚未配置 API Key'}</small></span></div><a className="admin-sidebar-chat" href="/">打开聊天演示 <span>↗</span></a></div>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar"><div><h1>{current.label}</h1></div><button className="admin-text-button" type="button" onClick={() => void logout()} disabled={busy === 'logout'}>{busy === 'logout' ? '退出中…' : '退出登录'}</button></header>
        {notice && <p className={`admin-notice admin-notice--floating is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
        <form className="admin-config-form" onSubmit={(event) => { event.preventDefault(); void saveConfig(); }}>
          {activeSection === 'overview' && <OverviewPage config={config} gameTypes={gameTypes} onNavigate={navigate} />}
          {activeSection === 'provider' && <ProviderPage config={config} apiBaseUrl={apiBaseUrl} apiKey={apiKey} model={model} imageApiBaseUrl={imageApiBaseUrl} imageApiRoute={imageApiRoute} imageApiKey={imageApiKey} imageProtocol={imageProtocol} imageModel={imageModel} models={models} busy={busy} setApiBaseUrl={setApiBaseUrl} setApiKey={setApiKey} setModel={setModel} setImageApiBaseUrl={setImageApiBaseUrl} setImageApiRoute={setImageApiRoute} setImageApiKey={setImageApiKey} setImageProtocol={setImageProtocol} setImageModel={setImageModel} loadModels={loadModels} />}
          {activeSection === 'game-types' && <GameTypesPage gameTypes={gameTypes} setGameTypes={setGameTypes} />}
          {activeSection === 'prompt' && <PromptPage systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt} />}
          {activeSection !== 'overview' && <footer className="admin-savebar"><div><strong>{config.apiKeyConfigured && config.imageApiKeyConfigured ? '双模型已配置' : '配置待完善'}</strong><small>上次保存：{formatUpdatedAt(config.updatedAt)}</small></div><div>{activeSection === 'provider' && config.imageApiKeyConfigured && <button className="admin-danger-button" type="button" onClick={() => { if (window.confirm('确定清除已保存的生图 Key？结果卡将不再生成 AI 背景。')) void saveConfig({ clearImageApiKey: true }); }} disabled={busy !== null}>清除生图 Key</button>}{config.apiKeyConfigured && <button className="admin-danger-button" type="button" onClick={() => { if (window.confirm('确定清除已保存的文本模型 Key？前台会回退到本地题卡。')) void saveConfig({ clearApiKey: true }); }} disabled={busy !== null}>清除文本 Key</button>}<button className="admin-primary-button" type="submit" disabled={busy !== null}>{saveLabel}</button></div></footer>}
        </form>
      </section>
    </main>
  );
}

function OverviewPage({ config, gameTypes, onNavigate }: { config: AdminConfig; gameTypes: AdminGameType[]; onNavigate: (path: string) => void }) {
  const cards = [
    { label: '模型接口', value: config.apiKeyConfigured && config.imageApiKeyConfigured ? '双模型已配置' : '待完善', detail: `${config.apiKeyConfigured ? config.model : '文本 Key 未配置'} · ${config.imageApiKeyConfigured ? config.imageModel : '生图 Key 未配置'}`, path: '/admin/provider', accent: 'purple' },
    { label: '游戏模板', value: `${gameTypes.filter((item) => item.enabled).length} 个启用`, detail: `共 ${gameTypes.length} 个模板`, path: '/admin/game-types', accent: 'orange' },
    { label: '系统提示词', value: `${config.systemPrompt.length} 字`, detail: '统一控制生成风格与边界', path: '/admin/prompt', accent: 'green' },
  ];
  return <div className="admin-content admin-content--overview">
    <div className="admin-stat-grid">{cards.map((card) => <button className={`admin-stat-card is-${card.accent}`} key={card.path} type="button" onClick={() => onNavigate(card.path)}><span className="admin-stat-card__label">{card.label}<b>→</b></span><strong>{card.value}</strong><small>{card.detail}</small></button>)}</div>
  </div>;
}

interface ProviderPageProps {
  config: AdminConfig;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  imageApiBaseUrl: string;
  imageApiRoute: string;
  imageApiKey: string;
  imageProtocol: AdminConfig['imageProtocol'];
  imageModel: string;
  models: string[];
  busy: string | null;
  setApiBaseUrl: (value: string) => void;
  setApiKey: (value: string) => void;
  setModel: (value: string) => void;
  setImageApiBaseUrl: (value: string) => void;
  setImageApiRoute: (value: string) => void;
  setImageApiKey: (value: string) => void;
  setImageProtocol: (value: AdminConfig['imageProtocol']) => void;
  setImageModel: (value: string) => void;
  loadModels: () => void;
}

function ProviderPage(props: ProviderPageProps) {
  const { config, apiBaseUrl, apiKey, model, imageApiBaseUrl, imageApiRoute, imageApiKey, imageProtocol, imageModel, models, busy, setApiBaseUrl, setApiKey, setModel, setImageApiBaseUrl, setImageApiRoute, setImageApiKey, setImageProtocol, setImageModel, loadModels } = props;
  return <div className="admin-content"><section className="admin-panel admin-panel--wide"><div className="admin-panel__heading"><div><span>01</span><h2>模型接口</h2></div><small>更新于 {formatUpdatedAt(config.updatedAt)}</small></div>
    <div className="admin-provider-block"><div className="admin-provider-block__heading"><div><strong>游戏内容模型</strong><small>OpenAI Chat Completions</small></div><em>{config.apiKeyConfigured ? '已连接' : '待配置'}</em></div>
      <div className="admin-form-grid"><label className="admin-field"><span>API Base URL</span><input type="url" value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} required /></label><label className="admin-field"><span>文本 API Key <em>{config.apiKeyConfigured ? '已配置' : '尚未配置'}</em></span><input type="password" name="api-key" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={config.apiKeyConfigured ? '留空即可保留当前 Key' : '粘贴文本模型 API Key'} /></label></div>
      <div className="admin-field"><span>文本模型</span><div className="admin-inline-field"><input list="available-models" value={model} onChange={(event) => setModel(event.target.value)} required /><datalist id="available-models">{models.map((item) => <option value={item} key={item} />)}</datalist><button type="button" onClick={loadModels} disabled={!config.apiKeyConfigured || busy === 'models'}>{busy === 'models' ? '检测中…' : '检测模型'}</button></div></div>
    </div>
    <div className="admin-provider-block is-image"><div className="admin-provider-block__heading"><div><strong>游戏结果卡生图</strong><small>TokenDance · Seedream</small></div><em>{config.imageApiKeyConfigured ? '已连接' : '待配置'}</em></div>
      <div className="admin-form-grid"><label className="admin-field"><span>生图 Base URL</span><input type="url" value={imageApiBaseUrl} onChange={(event) => setImageApiBaseUrl(event.target.value)} required /></label><label className="admin-field"><span>生图 API Key <em>{config.imageApiKeyConfigured ? '已配置' : '尚未配置'}</em></span><input type="password" name="image-api-key" autoComplete="new-password" value={imageApiKey} onChange={(event) => setImageApiKey(event.target.value)} placeholder={config.imageApiKeyConfigured ? '留空即可保留当前 Key' : '粘贴 TokenDance API Key'} /></label></div>
      <div className="admin-form-grid"><label className="admin-field"><span>请求路由</span><input value={imageApiRoute} onChange={(event) => setImageApiRoute(event.target.value)} required pattern="/.*" placeholder="/images/generations" /></label><label className="admin-field"><span>协议</span><select value={imageProtocol} onChange={(event) => setImageProtocol(event.target.value as AdminConfig['imageProtocol'])}><option value="ark:image-generations">Ark Image Generations</option><option value="openai:image-generations">OpenAI Image Generations</option></select></label></div>
      <label className="admin-field"><span>生图模型</span><input value={imageModel} onChange={(event) => setImageModel(event.target.value)} required placeholder="seedream-5.0-pro" /></label>
    </div>
    {models.length > 0 && <div className="admin-model-results"><strong>可用模型</strong>{models.map((item) => <button type="button" key={item} onClick={() => setModel(item)}>{item}</button>)}</div>}
  </section></div>;
}

function GameTypesPage({ gameTypes, setGameTypes }: { gameTypes: AdminGameType[]; setGameTypes: React.Dispatch<React.SetStateAction<AdminGameType[]>> }) {
  return <div className="admin-content"><section className="admin-panel admin-panel--wide"><div className="admin-panel__heading"><div><span>02</span><h2>游戏模板</h2></div><small>{gameTypes.filter((item) => item.enabled).length}/{gameTypes.length} 个启用</small></div><div className="admin-template-list">{gameTypes.map((item, index) => <article className={`admin-template-card ${item.enabled ? 'is-enabled' : ''}`} key={item.id}><header><div><code>{item.id}</code><strong>{item.label}</strong></div><label className="admin-template-toggle"><input type="checkbox" checked={item.enabled} onChange={(event) => setGameTypes((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, enabled: event.target.checked } : entry))} /><span>{item.enabled ? '已启用' : '已隐藏'}</span></label></header><label className="admin-field"><span>聊天页滚动关键词</span><input value={item.label} maxLength={60} onChange={(event) => setGameTypes((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry))} /></label><label className="admin-field"><span>该模板生成要求</span><textarea value={item.generationPrompt} rows={5} maxLength={4000} onChange={(event) => setGameTypes((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, generationPrompt: event.target.value } : entry))} /></label></article>)}</div></section></div>;
}

function PromptPage({ systemPrompt, setSystemPrompt }: { systemPrompt: string; setSystemPrompt: (value: string) => void }) {
  return <div className="admin-content"><section className="admin-panel admin-panel--wide admin-panel--prompt"><div className="admin-panel__heading"><div><span>03</span><h2>系统提示词</h2></div><small>{systemPrompt.length} 字</small></div><label className="admin-field admin-field--grow"><span>游戏设计要求</span><textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={24} /></label></section></div>;
}
