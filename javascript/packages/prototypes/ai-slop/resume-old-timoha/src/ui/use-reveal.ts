import { useEffect } from "react";

// Adds `is-in` to every [data-reveal] element the first time it enters the viewport.
const useReveal = () => {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    for (const element of document.querySelectorAll("[data-reveal]")) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);
};

export { useReveal };
