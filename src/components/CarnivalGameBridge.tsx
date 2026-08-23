import { useEffect, useMemo, useRef, useState } from 'react';
import type { CarnivalNetworkGameContext } from '../carnival-types';
import type { ParticipantId } from '../types';
import {
  CarnivalGameDialog,
  type CarnivalGameAction,
  type CarnivalGamePublicState,
  type CarnivalInvitePublicState,
  type CarnivalStableTemplateId,
} from './CarnivalGameDialog';
import {
  CarnivalExclusiveGameDialog,
  type CarnivalExclusiveAction,
  type CarnivalExclusiveInvitePublicState,
  type CarnivalExclusivePublicState,
} from './CarnivalExclusiveGameDialog';
import { exclusiveSeriesById } from '../carnival-exclusive';

const TEMPLATE_IDS = new Set<CarnivalStableTemplateId>([
  'profile-riddle',
  'keyword-wheel',
  'rapid-choice',
]);

function isGameState(value: unknown, inviteId: string, templateId: string): value is CarnivalGamePublicState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CarnivalGamePublicState>;
  return candidate.inviteId === inviteId && candidate.templateId === templateId &&
    typeof candidate.revision === 'number' && typeof candidate.serverNowMs === 'number';
}

function inviteState(context: CarnivalNetworkGameContext): CarnivalInvitePublicState | null {
  const invitation = context.invitation;
  if (!TEMPLATE_IDS.has(invitation.templateId as CarnivalStableTemplateId)) return null;
  const status = invitation.status === 'completed'
    ? 'completed'
    : invitation.status === 'expired'
      ? 'expired'
      : invitation.status === 'failed'
        ? 'cancelled'
        : invitation.joinedParticipantIds.length >= 2 || invitation.status === 'playing'
          ? 'active'
          : 'waiting';
  const createdBy: ParticipantId = invitation.creatorId === context.self.participantId ? 'a' : 'b';
  return {
    inviteId: invitation.inviteId,
    revision: invitation.game?.version ?? 0,
    status,
    templateId: invitation.templateId as CarnivalStableTemplateId,
    createdBy,
    participants: {
      a: {
        nickname: context.self.nickname,
        joined: invitation.joinedParticipantIds.includes(context.self.participantId),
        online: true,
      },
      b: {
        nickname: context.partner.nickname,
        joined: invitation.joinedParticipantIds.includes(context.partner.participantId),
        online: true,
      },
    },
  };
}

function exclusiveInviteState(context: CarnivalNetworkGameContext): CarnivalExclusiveInvitePublicState | null {
  const invitation = context.invitation;
  if (invitation.templateId !== 'custom') return null;
  const definition = invitation.game?.definition;
  const definitionSeriesId = definition && typeof definition === 'object' && 'seriesId' in definition
    ? (definition as { seriesId?: unknown }).seriesId
    : undefined;
  const series = exclusiveSeriesById(invitation.seriesId ?? definitionSeriesId);
  if (!series) return null;
  const status = invitation.status === 'completed'
    ? 'completed'
    : invitation.status === 'expired'
      ? 'expired'
      : invitation.status === 'failed'
        ? 'cancelled'
        : invitation.joinedParticipantIds.length >= 2 || invitation.status === 'playing'
          ? 'active'
          : 'waiting';
  return {
    inviteId: invitation.inviteId,
    revision: invitation.game?.version ?? 0,
    status,
    templateId: 'custom',
    seriesId: series.id,
    createdBy: invitation.creatorId === context.self.participantId ? 'a' : 'b',
    participants: {
      a: {
        nickname: context.self.nickname,
        joined: invitation.joinedParticipantIds.includes(context.self.participantId),
        online: true,
      },
      b: {
        nickname: context.partner.nickname,
        joined: invitation.joinedParticipantIds.includes(context.partner.participantId),
        online: true,
      },
    },
  };
}

function isExclusiveGameState(
  value: unknown,
  inviteId: string,
  seriesId: string,
): value is CarnivalExclusivePublicState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CarnivalExclusivePublicState>;
  return candidate.inviteId === inviteId && candidate.templateId === 'custom' &&
    candidate.seriesId === seriesId && typeof candidate.revision === 'number' &&
    typeof candidate.serverNowMs === 'number';
}

export interface CarnivalGameCompletion {
  invitation: CarnivalNetworkGameContext['invitation'];
  result: unknown;
  roomId: string;
  players: { a: { nickname: string }; b: { nickname: string } };
}

export function CarnivalGameBridge({
  context,
  onUseChatPrompt,
  onGameComplete,
}: {
  context: CarnivalNetworkGameContext;
  onUseChatPrompt?: (text: string) => void;
  onGameComplete?: (completion: CarnivalGameCompletion) => void;
}) {
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const joiningRef = useRef(false);
  const reportedCompletionRef = useRef<string | null>(null);
  const invite = useMemo(() => inviteState(context), [context]);
  const exclusiveInvite = useMemo(() => exclusiveInviteState(context), [context]);
  const gameState = invite && isGameState(
    context.invitation.game?.definition,
    context.inviteId,
    context.invitation.templateId,
  ) ? context.invitation.game.definition : null;
  const exclusiveGameState = exclusiveInvite && isExclusiveGameState(
    context.invitation.game?.definition,
    context.inviteId,
    exclusiveInvite.seriesId,
  ) ? context.invitation.game?.definition : null;
  const supportedInvite = invite ?? exclusiveInvite;
  const completionState = exclusiveGameState ?? gameState;
  const gameCompleted = Boolean(completionState && (
    supportedInvite?.status === 'completed' ||
    ('phase' in completionState && (completionState.phase === 'revealed' || completionState.phase === 'completed'))
  ));

  useEffect(() => {
    if (!onGameComplete || !gameCompleted || !completionState || !supportedInvite) return;
    if (reportedCompletionRef.current === context.inviteId) return;
    reportedCompletionRef.current = context.inviteId;
    onGameComplete({
      invitation: context.invitation,
      result: completionState,
      roomId: context.roomId,
      players: {
        a: { nickname: context.self.nickname },
        b: { nickname: context.partner.nickname },
      },
    });
  }, [completionState, context, gameCompleted, onGameComplete, supportedInvite]);

  const needsJoin = Boolean(supportedInvite && (
    !supportedInvite.participants.a.joined ||
    (invite && invite.templateId === 'rapid-choice' && invite.status === 'active' && gameState &&
      gameState.templateId === 'rapid-choice' && !gameState.self.deadlineAtMs && !gameState.self.completed)
  ));

  useEffect(() => {
    if (!supportedInvite || !needsJoin || joiningRef.current) return;
    joiningRef.current = true;
    setActionError(null);
    void context.sendAction('join').catch(() => {
      setActionError('暂时没能加入这一局，请关闭后重试。');
    }).finally(() => {
      joiningRef.current = false;
    });
  }, [context, needsJoin, supportedInvite]);

  if (!supportedInvite) {
    return (
      <div className="carnival-game-backdrop" role="presentation">
        <section className="carnival-game-dialog" role="dialog" aria-modal="true" aria-label="游戏暂不可用">
          <div className="carnival-game-notice">
            <span aria-hidden="true">!</span>
            <h3>这个玩法还在接入中</h3>
            <p>邀请卡仍会保留在聊天里，不会影响其他游戏。</p>
            <button className="carnival-game-primary" type="button" onClick={context.close}>返回聊天</button>
          </div>
        </section>
      </div>
    );
  }

  async function sendAction(inviteId: string, action: CarnivalGameAction | CarnivalExclusiveAction) {
    setActionPending(true);
    setActionError(null);
    const { type, requestId, expectedRevision, ...payload } = action;
    try {
      await context.sendAction(type, { ...payload, requestId, expectedRevision });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '这次操作还没有同步，请重试。');
      throw error;
    } finally {
      setActionPending(false);
    }
  }

  if (exclusiveInvite) {
    return (
      <CarnivalExclusiveGameDialog
        open
        participant="a"
        invite={exclusiveInvite}
        gameState={exclusiveGameState}
        actionPending={actionPending || joiningRef.current}
        actionError={actionError}
        onAction={sendAction}
        onClose={context.close}
        onUseChatPrompt={onUseChatPrompt}
      />
    );
  }

  if (!invite) return null;

  return (
    <CarnivalGameDialog
      open
      participant="a"
      invite={invite}
      gameState={gameState}
      actionPending={actionPending || joiningRef.current}
      actionError={actionError}
      onAction={sendAction}
      onClose={context.close}
      onUseChatPrompt={onUseChatPrompt}
    />
  );
}
