/** Join class names, dropping falsy values. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}

/**
 * Swap a Base UI part's `className` (which may be a function) for a plain
 * optional string so wrappers can merge it via `cn`.
 */
export type WithClass<T> = Omit<T, "className"> & { className?: string }
