import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";
import { TALENTS } from "../domain/talents";
import { Dossiers } from "./components/dossiers";
import { Footer } from "./components/footer";
import { Hero } from "./components/hero";
import { Offer } from "./components/offer";
import { Quote } from "./components/quote";
import { BackgroundCanvas } from "./components/shader-canvas";
import { Synergy } from "./components/synergy";
import { Talent } from "./components/talent";
import { Ticker } from "./components/ticker";
import { useReveal } from "./use-reveal";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  useReveal();

  return (
    <>
      <BackgroundCanvas />
      <div className="scanlines" aria-hidden="true" />
      <main className="page">
        <Hero />
        <Ticker />
        <Synergy />
        <Dossiers />
        {TALENTS.map((talent, index) => (
          <Talent key={talent.id} talent={talent} index={index + 3} flipped={index % 2 === 1} />
        ))}
        <Quote />
        <Offer registry={registry} />
        <Footer />
      </main>
    </>
  );
};

export { App };
