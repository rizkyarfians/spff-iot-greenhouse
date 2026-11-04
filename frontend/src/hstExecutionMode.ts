/** Selection in browser only; it is never an ESP32 selector or dispatch authority. */
export type HstOperatorMode = 'SHADOW' | 'TEST_REAL';

export function canReviewShadow(args: {
  mode: HstOperatorMode;
  previewOnly: boolean;
  status: 'WAITING_APPROVAL' | 'PARTIAL_WAITING_APPROVAL' | 'REQUIRES_REVIEW' | 'COMPLETED';
  remainingG: number | null;
}): boolean {
  return args.mode === 'SHADOW' && !args.previewOnly &&
    args.status !== 'COMPLETED' && args.status !== 'REQUIRES_REVIEW' &&
    args.remainingG !== null && Number.isFinite(args.remainingG) && args.remainingG > 0;
}
