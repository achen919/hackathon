import { useEffect, useMemo, useState } from 'react';
import type { GameTemplateId, GameTypeOption } from '../types';

interface RollingGameTitleProps {
  items: GameTypeOption[];
  activeId: GameTemplateId;
  paused?: boolean;
  onActiveChange: (id: GameTemplateId) => void;
}

export function RollingGameTitle({ items, activeId, paused = false, onActiveChange }: RollingGameTitleProps) {
  const [moving, setMoving] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const activeIndex = Math.max(0, items.findIndex((item) => item.id === activeId));
  const current = items[activeIndex] ?? items[0];
  const next = items[(activeIndex + 1) % Math.max(1, items.length)] ?? current;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion || moving || items.length < 2) return undefined;
    const timer = window.setTimeout(() => setMoving(true), 1_900);
    return () => window.clearTimeout(timer);
  }, [activeId, items.length, moving, paused, reducedMotion]);

  useEffect(() => {
    if (paused) setMoving(false);
  }, [activeId, paused]);

  const accessibleLabel = useMemo(() => current?.label ?? '小游戏', [current]);

  if (!current) return <h2>来一局小游戏吗？</h2>;

  return (
    <h2 className="rolling-game-title">
      <span aria-hidden="true">来一局</span>
      <span className="rolling-game-title__window" aria-hidden="true">
          <span
            className={`rolling-game-title__track ${moving ? 'is-moving' : ''}`}
            onTransitionEnd={(event) => {
              if (event.propertyName !== 'transform' || !moving || paused) {
                if (paused) setMoving(false);
                return;
              }
              onActiveChange(next.id);
              setMoving(false);
            }}
          >
            <span>{current.label}</span>
            <span>{next.label}</span>
          </span>
        </span>
      <span className="visually-hidden">来一局{accessibleLabel}吗？</span>
      <span aria-hidden="true">吗？</span>
    </h2>
  );
}
