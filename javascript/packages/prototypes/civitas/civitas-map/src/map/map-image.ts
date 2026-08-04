const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const ACCEPT_ATTRIBUTE = ".png,.jpg,.jpeg,.webp";

type LoadedMap = {
  bitmap: ImageBitmap;
  name: string;
  width: number;
  height: number;
};

function isAccepted(file: File): boolean {
  if (ACCEPTED_TYPES.includes(file.type)) {
    return true;
  }

  // Some file managers hand over an empty MIME type, so the extension is the
  // fallback rather than the primary check.
  return /\.(png|jpe?g|webp)$/i.test(file.name);
}

async function loadMapFile(file: File): Promise<LoadedMap> {
  if (!isAccepted(file)) {
    throw new Error(`${file.name} is not a png, jpg or webp image`);
  }

  // `createImageBitmap` decodes off the main thread, which matters because the
  // maps here run to tens of megapixels and an `<img>` decode blocks the frame.
  const bitmap = await createImageBitmap(file);

  return {
    bitmap,
    name: file.name,
    width: bitmap.width,
    height: bitmap.height,
  };
}

async function loadMapUrl(url: string): Promise<LoadedMap> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const name = url.split("/").pop() || url;

  return { bitmap, name, width: bitmap.width, height: bitmap.height };
}

export { ACCEPT_ATTRIBUTE, isAccepted, loadMapFile, loadMapUrl, type LoadedMap };
