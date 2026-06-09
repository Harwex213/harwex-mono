import { clsx } from "clsx";
import { router } from "../router-di";
import classes from "./sticky-header.module.css";
import { useEffect, useRef, useState } from "react";

const StickyHeader = () => {
  const [isStuck, setIsStuck] = useState(false);
  const sentinelRef = useRef(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        console.log("alo");
        // When sentinel is NOT intersecting viewport → header is stuck
        setIsStuck(!entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={classes.page}>
      <div className={classes.contentOne}>
        Content
      </div>

      <div ref={sentinelRef} className={classes.sentinel}/>

      <header className={classes.headerContainer}>
        <div className={clsx(classes.header, isStuck && classes.isStuck)}>
          Header
        </div>
      </header>

      <div className={classes.contentTwo}>
        Content Two
      </div>
    </div>
  )
}


router.registerRoute("/sticky-header", StickyHeader);