import { useEffect, useRef } from 'react';
import { Avatar } from './Avatar';
import { genderLabel, getUser, perspectiveLabel, toneFor } from '../lib/participants';
import type { MatchPayload, ParticipantId } from '../types';

interface ProfileExplorerProps {
  open: boolean;
  match: MatchPayload;
  viewer: ParticipantId;
  onViewerChange: (participant: ParticipantId) => void;
  onClose: () => void;
}

function cleanMarkdownText(value: string) {
  return value.replace(/\*\*/g, '').replace(/`/g, '').trim();
}

function ProfileMarkdown({ value }: { value: string }) {
  const lines = value.split('\n');

  return (
    <div className="profile-markdown">
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return null;

        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
          return <h4 key={`${index}-${line}`}>{cleanMarkdownText(heading[2])}</h4>;
        }

        if (line.startsWith('- ')) {
          const content = cleanMarkdownText(line.slice(2));
          const separator = content.search(/[:：]/);
          if (separator > 0 && separator < 18) {
            return (
              <div className="profile-fact" key={`${index}-${line}`}>
                <span>{content.slice(0, separator)}</span>
                <strong>{content.slice(separator + 1).trim()}</strong>
              </div>
            );
          }
          return (
            <div className="profile-bullet" key={`${index}-${line}`}>
              <i aria-hidden="true" />
              <span>{content}</span>
            </div>
          );
        }

        return <p key={`${index}-${line}`}>{cleanMarkdownText(line)}</p>;
      })}
    </div>
  );
}

function MemoryList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="profile-empty">接口中暂无这一类信息</p>;

  return (
    <ul className="memory-list">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function ProfileDetailCard({
  match,
  participant,
  viewer,
  onViewerChange,
}: {
  match: MatchPayload;
  participant: ParticipantId;
  viewer: ParticipantId;
  onViewerChange: (participant: ParticipantId) => void;
}) {
  const user = getUser(match, participant);
  const active = viewer === participant;

  return (
    <article className={`profile-detail-card profile-detail-card--${toneFor(participant)} ${active ? 'is-viewer' : ''}`}>
      <header className="profile-detail-card__header">
        <Avatar name={user.nickname} tone={toneFor(participant)} size="large" />
        <div>
          <span>{genderLabel(user, participant)} · 用户 {participant.toUpperCase()}</span>
          <h3>{user.nickname}</h3>
          <small>{active ? '当前聊天视角' : '另一方资料'}</small>
        </div>
        <button
          type="button"
          className={active ? 'profile-view-button is-active' : 'profile-view-button'}
          onClick={() => onViewerChange(participant)}
          aria-pressed={active}
        >
          {active ? '正在查看' : '切到 TA 视角'}
        </button>
      </header>

      <div className="profile-detail-card__body">
        <section className="profile-data-section">
          <div className="profile-data-section__title">
            <div>
              <span>01</span>
              <h4>完整个人资料</h4>
            </div>
            <small>用户资料</small>
          </div>
          <ProfileMarkdown value={user.profile} />
        </section>

        <section className="profile-data-section profile-data-section--private">
          <div className="profile-data-section__title">
            <div>
              <span>02</span>
              <h4>关于自己</h4>
            </div>
            <small>{user.memories_self.length} 条</small>
          </div>
          <MemoryList items={user.memories_self} />
        </section>

        <section className="profile-data-section profile-data-section--private">
          <div className="profile-data-section__title">
            <div>
              <span>03</span>
              <h4>期待对方</h4>
            </div>
            <small>{user.memories_ideal.length} 条</small>
          </div>
          <MemoryList items={user.memories_ideal} />
        </section>
      </div>
    </article>
  );
}

export function ProfileExplorer({
  open,
  match,
  viewer,
  onViewerChange,
  onClose,
}: ProfileExplorerProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const frame = window.requestAnimationFrame(() => {
      const firstButton = dialog?.querySelector<HTMLElement>('button:not(:disabled)');
      (firstButton ?? dialog)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="profile-explorer-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="profile-explorer"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="profile-explorer-title"
      >
        <header className="profile-explorer__header">
          <div>
            <h2 id="profile-explorer-title">双方完整资料</h2>
          </div>
          <div className="profile-explorer__actions">
            <div className="perspective-switch perspective-switch--profiles" role="group" aria-label="切换资料视角">
              {(['a', 'b'] as ParticipantId[]).map((participant) => (
                <button
                  key={participant}
                  type="button"
                  aria-pressed={viewer === participant}
                  className={viewer === participant ? 'is-active' : ''}
                  onClick={() => onViewerChange(participant)}
                >
                  {perspectiveLabel(match, participant)}
                </button>
              ))}
            </div>
            <button className="icon-button" type="button" onClick={onClose} aria-label="关闭双方资料">
              ×
            </button>
          </div>
        </header>

        <div className="profile-explorer__grid">
          <ProfileDetailCard match={match} participant="a" viewer={viewer} onViewerChange={onViewerChange} />
          <ProfileDetailCard match={match} participant="b" viewer={viewer} onViewerChange={onViewerChange} />
        </div>
      </section>
    </div>
  );
}
