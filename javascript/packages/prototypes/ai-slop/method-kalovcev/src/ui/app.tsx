import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";
import { DayClock } from "./components/day-clock";
import { Footer } from "./components/footer";
import { Forbidden } from "./components/forbidden";
import { Hero } from "./components/hero";
import { Manifesto } from "./components/manifesto";
import { Marquee } from "./components/marquee";
import { Pillars } from "./components/pillars";
import { Ritual } from "./components/ritual";
import { BackgroundCanvas } from "./components/shader-canvas";
import { Testimonials } from "./components/testimonials";
import { useReveal } from "./use-reveal";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  useReveal();

  return (
    <>
      <BackgroundCanvas />
      <main className="page">
        <Hero />
        <Manifesto />
        <Marquee />
        <Pillars />
        <DayClock />
        <Forbidden />
        <Testimonials />
        <Ritual registry={registry} />
        <Footer />
      </main>
    </>
  );
};

export { App };
