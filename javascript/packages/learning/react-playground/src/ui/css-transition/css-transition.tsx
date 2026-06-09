import { router } from "../router-di";
import classes from "./css-transition.module.css";
import { useEffect, useState } from "react";

const CssTransition = () => {
  const [height, setHeight] = useState(0);

  const onTransitionEnd = () => {
    console.log("transitionEnd!");
  }

  useEffect(() => {
    const doThing = () => {
      const height = Math.random() * 100_000 % 800 + 200;
      setHeight(height);
      setTimeout(doThing, 3000);
    };

    doThing();
  }, []);

  const style = { height: `${height}px` };

  return (
    <div className={classes.container} onTransitionEnd={onTransitionEnd}>
      <div style={style} className={classes.content}>
        Hello
      </div>
    </div>
  )
}


router.registerRoute("/css-transition", CssTransition);