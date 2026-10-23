import { useEffect, useState } from "react";

// Phones and small tablets get the mobile layout and the mobile shaders.
const MOBILE_QUERY = "(max-width: 820px)";

const useMobile = () => {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return mobile;
};

export { useMobile };
