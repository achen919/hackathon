import { useEffect, useState } from 'react';
import './admin.css';

interface AdminSession {
  authenticated: boolean;
  csrfToken?: string;
}

interface AdminConfig {
  apiBaseUrl: string;
  apiKeyConfigured: boolean;
  model: string;
  systemPrompt: string;
  gameTypes: AdminGameType[];
  updatedAt: string | null;
}

interface AdminGameType {
  id: 'profile-riddle' | 'keyword-wheel' | 'rapid-choice' | 'custom';
  label: string;
  enabled: boolean;
  generationPrompt: string;
}

interface ApiErrorBody {
  error?: string;
  code?: string;
}

class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

async function readApi<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) throw new ApiRequestError(payload.error ?? `请求失败（${response.status}）`, response.status);
  return payload;
}

function formatUpdatedAt(value: string | null) {
  if (!value) return '尚未保存';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export default function AdminPage() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [password, setPassword] = useState('');
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [gameTypes, setGameTypes] = useState<AdminGameType[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<'login' | 'save' | 'models' | 'logout' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  function applyConfig(next: AdminConfig) {
    setConfig(next);
    setApiBaseUrl(next.apiBaseUrl);
    setModel(next.model);
    setSystemPrompt(next.systemPrompt);
    setGameTypes(next.gameTypes.map((item) => ({ ...item })));
  }

  async function loadConfig() {
    const response = await fetch('/api/admin/config', { credentials: 'same-origin' });
    applyConfig(await readApi<AdminConfig>(response));
    setPageError(null);
  }

  function handleFailure(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback;
    if (error instanceof ApiRequestError && error.status === 401) {
      setSession({ authenticated: false });
      setConfig(null);
      setNotice({ tone: 'error', text: '管理会话已过期，请重新登录。' });
      return;
    }
    setNotice({ tone: 'error', text: message });
  }

  useEffect(() => {
    let active = true;
    let sessionWasAuthenticated = false;
    void fetch('/api/admin/session', { credentials: 'same-origin' })
      .then((response) => readApi<AdminSession>(response))
      .then(async (nextSession) => {
        if (!active) return;
        sessionWasAuthenticated = nextSession.authenticated;
        setSession(nextSession);
        if (nextSession.authenticated) await loadConfig();
      })
      .catch((error: Error) => {
        if (active) {
          if (sessionWasAuthenticated) setPageError(error.message);
          else {
            setSession({ authenticated: false });
            setNotice({ tone: 'error', text: error.message });
          }
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy('login');
    setNotice(null);
    let loginEstablished = false;
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const nextSession = await readApi<AdminSession>(response);
      loginEstablished = nextSession.authenticated;
      setSession(nextSession);
      setPassword('');
      await loadConfig();
      setNotice({ tone: 'success', text: '已安全登录管理后台。' });
    } catch (error) {
      if (loginEstablished && !(error instanceof ApiRequestError && error.status === 401)) {
        setPageError(error instanceof Error ? error.message : '无法读取配置');
      } else handleFailure(error, '登录失败');
    } finally {
      setBusy(null);
    }
  }

  async function saveConfig(options: { clearApiKey?: boolean } = {}) {
    if (!session?.csrfToken) return;
    if (!gameTypes.some((item) => item.enabled)) {
      setNotice({ tone: 'error', text: '至少保留一种候选游戏类型。' });
      return;
    }
    setBusy('save');
    setNotice(null);
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrfToken,
        },
        body: JSON.stringify({
          apiBaseUrl,
          apiKey,
          clearApiKey: options.clearApiKey === true,
          model,
          systemPrompt,
          gameTypes,
        }),
      });
      const next = await readApi<AdminConfig>(response);
      applyConfig(next);
      setApiKey('');
      setModels([]);
      setNotice({
        tone: 'success',
        text: options.clearApiKey ? 'API Key 已清除，前台将使用安全题卡。' : '配置已加密保存，下一局立即生效。',
      });
    } catch (error) {
      handleFailure(error, '保存失败');
    } finally {
      setBusy(null);
    }
  }

  async function loadModels() {
    if (!session?.csrfToken) return;
    setBusy('models');
    setNotice({ tone: 'info', text: '正在用已保存的 Key 读取可用模型…' });
    try {
      const response = await fetch('/api/admin/models', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrfToken,
        },
        body: '{}',
      });
      const payload = await readApi<{ models: string[] }>(response);
      setModels(payload.models);
      setNotice({ tone: 'success', text: `连接成功，当前 Key 可见 ${payload.models.length} 个模型。` });
    } catch (error) {
      handleFailure(error, '连接失败');
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    if (!session?.csrfToken) return;
    setBusy('logout');
    try {
      await readApi(await fetch('/api/admin/session', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-CSRF-Token': session.csrfToken,
        },
        body: '{}',
      }));
      setSession({ authenticated: false });
      setConfig(null);
      setNotice({ tone: 'info', text: '已退出管理后台。' });
    } catch (error) {
      handleFailure(error, '退出失败，请重试');
    } finally {
      setBusy(null);
    }
  }

  if (session === null) {
    return <main className="admin-loading"><span>良</span><p>正在确认管理会话…</p></main>;
  }

  if (!session.authenticated) {
    return (
      <main className="admin-login-shell">
        <a className="admin-back-link" href="/">← 返回聊天演示</a>
        <form className="admin-login-card" onSubmit={login}>
          <div className="admin-brand-mark">良</div>
          <p className="eyebrow">PAIR PLAYGROUND · ADMIN</p>
          <h1>专属游戏控制台</h1>
          <p className="admin-login-card__intro">管理 AI 接口、模型、候选游戏类型与系统提示词。密钥不会返回浏览器。</p>
          <input type="hidden" name="username" autoComplete="username" value="admin" />
          <label className="admin-field">
            <span>管理员密码</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="输入独立管理密码"
              required
            />
          </label>
          {notice && <p className={`admin-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
          <button className="admin-primary-button" type="submit" disabled={busy === 'login'}>
            {busy === 'login' ? '正在验证…' : '进入控制台'}
          </button>
          <small>会话使用 HttpOnly 安全 Cookie，30 分钟无操作自动过期。</small>
        </form>
      </main>
    );
  }

  if (!config) return (
    <main className="admin-loading">
      <span>良</span>
      <p>{pageError ?? '正在读取 AI 配置…'}</p>
      {pageError && <button className="admin-primary-button" type="button" onClick={() => {
        setPageError(null);
        void loadConfig().catch((error) => {
          if (error instanceof ApiRequestError && error.status === 401) handleFailure(error, '会话已过期');
          else setPageError(error instanceof Error ? error.message : '重试失败');
        });
      }}>重新读取配置</button>}
    </main>
  );

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <a className="admin-wordmark" href="/"><span>良</span><strong>Pair Playground</strong></a>
        <div>
          <a className="admin-secondary-button" href="/">打开聊天演示</a>
          <button className="admin-text-button" type="button" onClick={() => void logout()} disabled={busy === 'logout'}>退出</button>
        </div>
      </header>

      <section className="admin-hero">
        <div>
          <p className="eyebrow">AI GAME STUDIO</p>
          <h1>让每一对匹配，都有不重样的破冰局</h1>
          <p>模型会理解最近公开聊天与服务端提炼的非敏感资料信号，再按你选择的固定玩法生成专属题面。固定安全规则不会被自定义提示词覆盖。</p>
        </div>
        <div className="admin-status-card">
          <span className={config.apiKeyConfigured ? 'is-online' : 'is-offline'} />
          <div><strong>{config.apiKeyConfigured ? 'AI 已配置' : 'AI 尚未配置'}</strong><small>{config.apiKeyConfigured ? `${config.model} · 前台可生成` : '前台自动使用安全题卡'}</small></div>
        </div>
      </section>

      <form className="admin-config-form" onSubmit={(event) => { event.preventDefault(); void saveConfig(); }}>
        <input type="hidden" name="username" autoComplete="username" value="admin" />
        {notice && <p className={`admin-notice admin-notice--floating is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}

        <div className="admin-grid">
        <section className="admin-panel admin-panel--provider">
          <div className="admin-panel__heading">
            <div><span>01</span><h2>模型接口</h2></div>
            <small>更新于 {formatUpdatedAt(config.updatedAt)}</small>
          </div>

          <label className="admin-field">
            <span>API Base URL</span>
            <input type="url" value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} required />
            <small>填写服务根地址或以 /v1 结尾的地址，后端会统一调用 Chat Completions。</small>
          </label>

          <label className="admin-field">
            <span>API Key <em>{config.apiKeyConfigured ? '已安全配置' : '未配置'}</em></span>
            <input
              type="password"
              name="api-key"
              autoComplete="new-password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={config.apiKeyConfigured ? '留空即保留当前 Key' : '粘贴新的 API Key'}
            />
            <small>保存后输入框会立即清空，服务端读取时也不会把 Key 返回页面。</small>
          </label>

          <div className="admin-field">
            <span>模型</span>
            <div className="admin-inline-field">
              <input list="available-models" value={model} onChange={(event) => setModel(event.target.value)} required />
              <datalist id="available-models">{models.map((item) => <option value={item} key={item} />)}</datalist>
              <button type="button" onClick={() => void loadModels()} disabled={!config.apiKeyConfigured || busy === 'models'}>
                {busy === 'models' ? '检测中…' : '检测模型'}
              </button>
            </div>
            <small>检测使用“已保存”的 Key。新 Key 请先保存，再检测权限。</small>
          </div>

          <div className="admin-security-strip">
            <span>✓ Key 加密落盘</span><span>✓ 仅后端调用</span><span>✓ 上游拒绝重定向</span>
          </div>
        </section>

        <section className="admin-panel admin-panel--types">
          <div className="admin-panel__heading"><div><span>02</span><h2>滚动关键词与模板</h2></div><small>{gameTypes.filter((item) => item.enabled).length}/{gameTypes.length}</small></div>
          <p className="admin-panel__intro">模板 ID 和交互机制固定，滚动展示词与该模板的生成要求可以随时修改。</p>
          <div className="admin-template-list">
            {gameTypes.map((item, index) => (
              <article className={`admin-template-card ${item.enabled ? 'is-enabled' : ''}`} key={item.id}>
                <header>
                  <div><code>{item.id}</code><strong>{item.label}</strong></div>
                  <label className="admin-template-toggle">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(event) => setGameTypes((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, enabled: event.target.checked } : entry))}
                    />
                    <span>{item.enabled ? '展示' : '隐藏'}</span>
                  </label>
                </header>
                <label className="admin-field">
                  <span>聊天页滚动关键词</span>
                  <input
                    value={item.label}
                    maxLength={60}
                    onChange={(event) => setGameTypes((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry))}
                  />
                </label>
                <label className="admin-field">
                  <span>该模板生成要求</span>
                  <textarea
                    value={item.generationPrompt}
                    rows={5}
                    maxLength={4_000}
                    onChange={(event) => setGameTypes((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, generationPrompt: event.target.value } : entry))}
                  />
                </label>
                {item.id === 'custom' && <small className="admin-template-card__waiting">专属小游戏已在游园会接入五个双端系列；这里配置入口名称和通用生成要求，用户发起前仍可编辑本局 Prompt。</small>}
              </article>
            ))}
          </div>
        </section>

        <section className="admin-panel admin-panel--prompt">
          <div className="admin-panel__heading"><div><span>03</span><h2>系统提示词</h2></div><small>{systemPrompt.length} 字</small></div>
          <label className="admin-field admin-field--grow">
            <span>游戏设计要求</span>
            <textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={15} />
            <small>可调整语气、轮次节奏和业务目标；防泄密、反操纵等硬边界由后端额外注入。</small>
          </label>
        </section>

        <aside className="admin-panel admin-panel--flow">
          <div className="admin-panel__heading"><div><span>04</span><h2>生成链路</h2></div></div>
          <ol className="admin-flow-list">
            <li><span>1</span><div><strong>理解两个人</strong><small>最近公开聊天与非敏感资料信号，不发送原始私密资料</small></div></li>
            <li><span>2</span><div><strong>锁定玩法模板</strong><small>稳定 ID 对应下拉、转盘或五秒二选一</small></div></li>
            <li><span>3</span><div><strong>用户确认 Prompt</strong><small>先生成安全简报，允许本人修改后再开始</small></div></li>
            <li><span>4</span><div><strong>本地安全校验</strong><small>不合格输出不会进入前台，自动回退题库</small></div></li>
          </ol>
          <a className="admin-demo-link" href="/">去聊天页生成一局 <span>→</span></a>
        </aside>
        </div>

        <footer className="admin-savebar">
          <div><strong>{config.apiKeyConfigured ? '服务已就绪' : '还差一个 API Key'}</strong><small>保存后新配置会立即用于下一次游戏生成。</small></div>
          <div>
            {config.apiKeyConfigured && <button className="admin-danger-button" type="button" onClick={() => window.confirm('确定清除已保存的 API Key？前台会回退到本地题卡。') && void saveConfig({ clearApiKey: true })} disabled={busy !== null}>清除 Key</button>}
            <button className="admin-primary-button" type="submit" disabled={busy !== null}>
              {busy === 'save' ? '正在加密保存…' : '保存并立即生效'}
            </button>
          </div>
        </footer>
      </form>
    </main>
  );
}
