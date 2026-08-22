import { useEffect, useRef } from 'react';
import type { GameTemplateId, GameTypeOption } from '../types';

interface GamePromptStudioProps {
  open: boolean;
  options: GameTypeOption[];
  selectedId: GameTemplateId;
  prompt: string;
  status: 'idle' | 'loading' | 'editing' | 'generating' | 'error';
  error: string | null;
  usesAi: boolean;
  onSelect: (id: GameTemplateId) => void;
  onPromptChange: (value: string) => void;
  onStart: () => void;
  onClose: () => void;
}

export function GamePromptStudio({
  open,
  options,
  selectedId,
  prompt,
  status,
  error,
  usesAi,
  onSelect,
  onPromptChange,
  onStart,
  onClose,
}: GamePromptStudioProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const selected = options.find((option) => option.id === selectedId) ?? options[0];

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const frame = window.requestAnimationFrame(() => dialog?.querySelector<HTMLElement>('textarea, button:not(:disabled)')?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open || !selected) return null;
  const busy = status === 'loading' || status === 'generating';

  return (
    <div className="prompt-studio-backdrop" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={dialogRef}
        className="prompt-studio"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-studio-title"
        tabIndex={-1}
      >
        <header className="prompt-studio__header">
          <div>
            <p className="eyebrow">GAME BRIEF · 可编辑</p>
            <h2 id="prompt-studio-title">先决定这一局怎么玩</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭游戏设置">×</button>
        </header>

        <div className="prompt-studio__types" role="list" aria-label="选择游戏模板">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={busy}
              className={option.id === selected.id ? 'is-active' : ''}
              aria-pressed={option.id === selected.id}
              onClick={() => onSelect(option.id)}
            >
              <strong>{option.label}</strong>
              <small>{option.available ? '模板已就绪' : '扩展接入中'}</small>
            </button>
          ))}
        </div>

        <div className="prompt-studio__template-note">
          <span>{selected.label}</span>
          <p>{selected.description}</p>
        </div>

        <label className="prompt-studio__field">
          <span>本局 Prompt <em>根据聊天上下文生成，可在开始前修改</em></span>
          <textarea
            value={prompt}
            maxLength={1_500}
            rows={10}
            disabled={busy || !selected.available}
            placeholder={status === 'loading' ? '正在从公开聊天线索生成 Prompt…' : '写下你希望这一局更关注什么'}
            onChange={(event) => onPromptChange(event.target.value)}
          />
          <small>{prompt.length}/1500 · 完整资料不会直接出现在编辑框中</small>
        </label>

        {error && <p className="prompt-studio__error" role="alert">{error}</p>}
        {!selected.available && (
          <p className="prompt-studio__waiting" role="status">这个模板已保留稳定接口，等待团队中的“专属小游戏”模块接入。</p>
        )}

        <footer className="prompt-studio__actions">
          <button className="secondary-button" type="button" onClick={onClose}>先不玩</button>
          <button
            className="primary-button"
            type="button"
            disabled={busy || !selected.available || prompt.trim().length < 20}
            onClick={onStart}
          >
            {status === 'generating'
              ? '正在生成游戏…'
              : usesAi
                ? '按这个 Prompt 生成并开始'
                : '使用模板立即开始'}
          </button>
        </footer>
      </section>
    </div>
  );
}
