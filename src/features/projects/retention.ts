export function retentionRefreshDelay(deadlines: (string | null | undefined)[], now: number): number | null {
  const next = deadlines.map(value => value ? Date.parse(value) : NaN)
    .filter(time => Number.isFinite(time) && time > now).sort((a, b) => a - b)[0];
  return next === undefined ? null : Math.min(next - now + 50, 2_147_483_647);
}
