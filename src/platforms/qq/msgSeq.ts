const lastSeqByUser = new Map<string, number>();

export function nextQqMsgSeq(userId: string): number {
  const prev = lastSeqByUser.get(userId) ?? 0;
  const next = prev + 1;
  lastSeqByUser.set(userId, next);
  return next;
}

export function resetQqMsgSeq(userId: string): void {
  lastSeqByUser.delete(userId);
}
