import { signal } from "@preact/signals-react";

/**
 * The wire being drawn, if one is. It lives on its own so that the canvas can
 * draw it, the cards can light up the sockets that would take it, and neither
 * has to import the other.
 */
const linkDraft = signal<{ fromId: string; x: number; y: number } | null>(null);

export { linkDraft };
