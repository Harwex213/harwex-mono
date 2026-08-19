import { useEffect } from "react";

// Marks the document once React has committed and the fonts have loaded. Tests
// wait for `html[data-app-ready="true"]` instead of guessing with a timeout,
// which is what keeps a screenshot from catching a half-laid-out page.

function ReadyFlag() {
  useEffect(() => {
    let cancelled = false;
    const mark = () => {
      if (!cancelled) {
        document.documentElement.dataset.appReady = "true";
      }
    };
    void document.fonts.ready.then(() => {
      requestAnimationFrame(mark);
    });
    return () => {
      cancelled = true;
      delete document.documentElement.dataset.appReady;
    };
  }, []);
  return null;
}

export { ReadyFlag };
