// Time helpers for content tables. All game durations are integer milliseconds.
export const sec = (n) => Math.round(n * 1000);
export const min = (n) => Math.round(n * 60_000);
export const h = (n) => Math.round(n * 3_600_000);
export const d = (n) => Math.round(n * 86_400_000);
