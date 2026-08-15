/**
 * Ids are short and readable so an exported document stays easy to eyeball.
 * The random suffix keeps ids unique across a reload, where a plain counter
 * would restart at 1 and collide with the ids already stored in localStorage.
 */
function createId(prefix: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);

  return `${prefix}-${suffix}`;
}

export { createId };
