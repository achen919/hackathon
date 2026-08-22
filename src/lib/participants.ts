import type { MatchPayload, MatchUser, ParticipantId } from '../types';

export function getUser(match: MatchPayload, participant: ParticipantId) {
  return participant === 'a' ? match.user_a : match.user_b;
}

export function otherParticipant(participant: ParticipantId): ParticipantId {
  return participant === 'a' ? 'b' : 'a';
}

export function toneFor(participant: ParticipantId): 'violet' | 'coral' {
  return participant === 'a' ? 'violet' : 'coral';
}

export function genderLabel(user: MatchUser, participant: ParticipantId) {
  const normalized = user.gender.toLowerCase();
  if (normalized === 'female' || normalized === '女') return '女方';
  if (normalized === 'male' || normalized === '男') return '男方';
  return participant === 'a' ? 'A 方' : 'B 方';
}

export function perspectiveLabel(match: MatchPayload, participant: ParticipantId) {
  const user = getUser(match, participant);
  return `${genderLabel(user, participant)} · ${user.nickname}`;
}
