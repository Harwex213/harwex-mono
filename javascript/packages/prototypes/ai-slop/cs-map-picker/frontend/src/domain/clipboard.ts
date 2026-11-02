// The clipboard API needs a secure context; plain http falls back to a selected textarea.
const copyText = async (text: string) => {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the textarea
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
};

const copyImage = async (url: string) => {
  if (!navigator.clipboard || !window.isSecureContext || typeof ClipboardItem === "undefined") {
    return false;
  }
  try {
    // A promise of a blob keeps the copy inside the click gesture in Safari.
    const blob = fetch(url).then((response) => response.blob());
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
};

export { copyText, copyImage };
