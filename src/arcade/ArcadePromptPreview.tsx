import { useEffect, useMemo, useRef, useState } from 'react';
import type { CarnivalArcadeGameDefinition, CarnivalGamePreview } from '../carnival-types';
import { ArcadeGameRuntime } from './ArcadeGameRuntime';
import { GeneratedGameSandbox } from './GeneratedGameSandbox';
import { arcadeFallbackFromServerDefinition } from './registry';

interface ArcadePromptPreviewProps {
  preview: CarnivalGamePreview & { game: CarnivalArcadeGameDefinition };
  expired: boolean;
  footerNote?: string;
  onComplete?: () => void;
  onRestart?: () => void;
}

function previewClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function seedFromHash(hash: string) {
  const value = Number.parseInt(hash.slice(0, 8), 16);
  return Number.isFinite(value) ? value : 2_026_082_3;
}

export function ArcadePromptPreview({
  preview,
  expired,
  footerNote,
  onComplete,
  onRestart,
}: ArcadePromptPreviewProps) {
  const { game } = preview;
  const [roleIndex, setRoleIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [useSafeFallback, setUseSafeFallback] = useState(false);
  const completedRef = useRef(false);
  const fallbackDefinition = useMemo(() => arcadeFallbackFromServerDefinition(game), [game]);
  const role = game.arcade.roles[roleIndex] ?? game.arcade.roles[0];

  useEffect(() => {
    setRoleIndex(0);
    setRun(0);
    setUseSafeFallback(false);
    completedRef.current = false;
  }, [preview.previewToken]);

  const completeOnce = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete?.();
  };
  const restart = () => {
    completedRef.current = false;
    setUseSafeFallback(false);
    setRun((current) => current + 1);
    onRestart?.();
  };

  return (
    <section className={`arcade-prompt-preview theme-${game.arcade.theme}`} aria-labelledby="arcade-prompt-preview-title">
      <header className="arcade-prompt-preview__header">
        <div>
          <span><i aria-hidden="true" /> LIVE CODE PREVIEW</span>
          <h3 id="arcade-prompt-preview-title">{game.title}</h3>
          <p>{game.description}</p>
        </div>
        <div className="arcade-prompt-preview__badges">
          <b>{game.generatedBy === 'ai' ? 'AI 生成代码' : '安全离线代码'}</b>
          <b>{game.arcade.kind === 'cooperation' ? '合作' : game.arcade.kind === 'sport' ? '运动攻防' : game.arcade.kind === 'adventure' ? '冒险' : game.arcade.kind === 'strategy' ? '策略' : '实时对抗'}</b>
        </div>
      </header>

      <div className="arcade-prompt-preview__roles" role="group" aria-label="切换试玩角色">
        {game.arcade.roles.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={roleIndex === index}
            disabled={expired}
            onClick={() => {
              setRoleIndex(index);
              setRun((current) => current + 1);
            }}
          >
            <strong>{item.label}</strong><small>{item.objective}</small>
          </button>
        ))}
      </div>

      {useSafeFallback && fallbackDefinition ? (
        <ArcadeGameRuntime
          key={`${preview.previewToken}-fallback-${run}`}
          definition={fallbackDefinition}
          viewer={roleIndex === 0 ? 'a' : 'b'}
          players={{ a: { nickname: '角色 A' }, b: { nickname: '角色 B' } }}
          sessionKey={`${preview.previewToken}-fallback-${run}`}
          paused={expired}
          mode="local-preview"
          allowPerspectiveSwitch
          onComplete={completeOnce}
        />
      ) : (
        <GeneratedGameSandbox
          key={`${preview.previewToken}-${role.id}-${run}`}
          artifact={game.artifact}
          role={role.id}
          playMode="preview"
          mode={game.arcade.preset}
          seed={seedFromHash(game.artifact.codeHash)}
          allowedControls={role.controls}
          paused={expired}
          title={game.title}
          onInput={() => undefined}
          onComplete={completeOnce}
          onError={() => setUseSafeFallback(Boolean(fallbackDefinition))}
        />
      )}

      <footer className="arcade-prompt-preview__footer" aria-live="polite">
        <span>{expired ? '这个生成版本已经过期，请重新生成' : `正在试玩 ${role.label} · ${role.controls.join(' / ')}`}</span>
        <small>{footerNote ?? `同一份代码版本保留至 ${previewClock(preview.expiresAt)}`}</small>
        <button type="button" disabled={expired} onClick={restart}>重新开始这局</button>
      </footer>
    </section>
  );
}
