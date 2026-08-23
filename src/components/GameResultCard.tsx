import type { GameResultCard } from '../types';

interface GameResultCardViewProps {
  card: GameResultCard;
  compact?: boolean;
  onPrompt?: (text: string) => void;
}

export function GameResultCardView({ card, compact = false, onPrompt }: GameResultCardViewProps) {
  return (
    <article
      aria-busy={card.status === 'generating'}
      className={`game-result-card ${compact ? 'game-result-card--compact' : ''} game-result-card--${card.status}`}
      style={card.backgroundUrl ? { backgroundImage: `linear-gradient(180deg, rgba(35, 28, 47, .15), rgba(35, 28, 47, .86)), url("${card.backgroundUrl}")` } : undefined}
    >
      <div className="game-result-card__content">
        <div className="game-result-card__topline">
          <span className="game-result-card__badge">{card.badge}</span>
        </div>
        <div className="game-result-card__score"><strong>{card.score}</strong><span>/ 100<br />AI 评估</span></div>
        <h3>{card.headline}</h3>
        {!compact && <ul>{card.highlights.map((item) => <li key={item}>{item}</li>)}</ul>}
        <div className="game-result-card__footer">
          <span>下一步 · {card.nextPrompt}</span>
          {onPrompt && <button type="button" onClick={() => onPrompt(card.nextPrompt)}>继续聊这个</button>}
        </div>
        <small className="game-result-card__source">{card.status === 'generating' ? 'AI 正在评估并生成背景…' : card.generatedBy === 'ai' ? (card.backgroundUrl ? 'AI 评估 · AI 背景' : 'AI 评估 · 文字卡片') : '本地安全评估 · 可继续聊天'} · {new Date(card.createdAt).toLocaleString('zh-CN', { hour12: false })}</small>
      </div>
    </article>
  );
}
