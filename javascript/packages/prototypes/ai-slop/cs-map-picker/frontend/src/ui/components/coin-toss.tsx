import { useEffect, useState } from "react";
import type { FC } from "react";

type TCoinTossProps = {
  winner: string;
  // The flip plays only for a fresh toss; a reopened pick shows the result at once.
  animate: boolean;
};

const FLIP_MS = 1800;

const CoinToss: FC<TCoinTossProps> = ({ winner, animate }) => {
  const [flipping, setFlipping] = useState(animate);

  useEffect(() => {
    if (!flipping) {
      return;
    }
    const timer = window.setTimeout(() => setFlipping(false), FLIP_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [flipping]);

  return (
    <div className="coin-toss">
      <div className={flipping ? "coin coin-flipping" : "coin"} aria-hidden="true">
        <span className="coin-face">★</span>
      </div>
      <div>
        <div className="muted small">Монетка</div>
        <div className="coin-result">{flipping ? "Подбрасываем…" : `Первым банит ${winner}`}</div>
      </div>
    </div>
  );
};

export { CoinToss };
