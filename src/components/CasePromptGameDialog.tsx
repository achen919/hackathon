import { useEffect, useRef } from 'react';
import { ArcadeGameRuntime, type ArcadeGameDefinition } from '../arcade';
import type { CarnivalGamePreview } from '../carnival-types';
import { PromptGamePreviewCard } from './PromptGamePreviewCard';

interface CasePromptGameDialogProps {
  open: boolean;
  preview?: CarnivalGamePreview;
  localArcade?: ArcadeGameDefinition;
  onClose: () => void;
  onComplete: () => void;
  onRestart: () => void;
}

export function CasePromptGameDialog({
  open,
  preview,
  localArcade,
  onClose,
  onComplete,
  onRestart,
}: CasePromptGameDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const frame = window.requestAnimationFrame(() => dialog?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
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

  return (
    <div
      className="carnival-modal-backdrop case-prompt-game-backdrop"
      role="presentation"
      hidden={!open}
      aria-hidden={!open}
      inert={!open}
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialogRef}
        className="carnival-modal case-prompt-game-dialog"
        role="dialog"
        aria-modal={open ? 'true' : undefined}
        aria-labelledby="case-prompt-game-title"
        tabIndex={-1}
      >
        <header className="carnival-modal__header">
          <div><h2 id="case-prompt-game-title">Prompt 已变成可玩游戏</h2></div>
          <button type="button" onClick={onClose} aria-label="收起游戏，返回案例聊天">×</button>
        </header>
        {preview ? (
          <PromptGamePreviewCard
            preview={preview}
            expired={false}
            onComplete={onComplete}
            onRestart={onRestart}
          />
        ) : localArcade ? (
          <ArcadeGameRuntime
            definition={localArcade}
            viewer="a"
            players={{ a: { nickname: '角色 A' }, b: { nickname: '角色 B' } }}
            sessionKey={`case-${localArcade.seed}`}
            mode="local-preview"
            allowPerspectiveSwitch
            onComplete={onComplete}
          />
        ) : (
          <p className="carnival-game-notice" role="alert">这局游戏暂时无法载入，请返回重新生成。</p>
        )}
      </section>
    </div>
  );
}
