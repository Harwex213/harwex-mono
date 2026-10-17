import { resolveVaultImage } from "./vault-links";
import type { TStore } from "../store/store";
import type { TApiClient } from "../api/api";

// The URL a Markdown image loads from (MD-5). The renderer calls it while it draws, so it
// answers at once: it only reads the tree and changes nothing. Null when the path names no
// image of the vault, and the viewer shows its placeholder instead.
const resolveVaultImageAction = (
  store: TStore,
  api: TApiClient,
  fromNodeId: string,
  src: string
): string | null => {
  const image = resolveVaultImage(store.fs.nodes.peek(), fromNodeId, src);
  if (image === null) {
    return null;
  }

  const version = store.sync.imageVersionById.peek().get(image.nodeId);

  return api.raw.url(version === undefined ? image : { ...image, version });
};

export { resolveVaultImageAction };
