/** Join class names, skipping anything falsy (nested arrays allowed). */
export function cn(...parts: unknown[]): string {
  return (parts.flat(Infinity) as unknown[]).filter(Boolean).join(" ");
}
