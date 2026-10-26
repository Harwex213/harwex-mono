import { useSignals } from "@preact/signals-react/runtime";
import type { ChangeEvent, FC } from "react";
import { SYNERGY } from "../../domain/candidates";
import type { TAppRegistry } from "../../domain/registry";
import { useStore } from "../../store/store";

type TOfferProps = {
  registry: TAppRegistry;
};

const formatMoney = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} BYN`;

const Offer: FC<TOfferProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const salary = store.offer.salary.value;
  const hired = store.offer.hired.value;

  // The market pays one salary per HR. The duo does the work of SYNERGY HRs for one salary.
  const market = salary * SYNERGY;
  const saved = market - salary;

  const onSalary = (event: ChangeEvent<HTMLInputElement>) => {
    registry.setSalaryAction(Number(event.target.value));
  };

  return (
    <section className="section offer" id="offer">
      <div className="section__head" data-reveal>
        <p className="tag">// 06 — ОФФЕР</p>
        <h2>Калькулятор выгоды</h2>
      </div>
      <div className="offer__card" data-reveal>
        <label className="offer__slider">
          <span>Зарплата одного HR-менеджера</span>
          <b>{formatMoney(salary)}</b>
          <input type="range" min={500} max={5000} step={100} value={salary} onChange={onSalary} />
        </label>
        <div className="offer__numbers">
          <div>
            <span>{SYNERGY} обычных HR стоят</span>
            <b className="accent-cyan">{formatMoney(market)}</b>
          </div>
          <div>
            <span>Старый Тимоха стоит</span>
            <b className="accent-magenta">{formatMoney(salary)}</b>
          </div>
          <div>
            <span>Экономия компании</span>
            <b className="offer__saved">{formatMoney(saved)}</b>
          </div>
        </div>
        {hired ? (
          <div className="offer__hired">
            <span className="glitch" data-text="ДУЭТ НАНЯТ">
              ДУЭТ НАНЯТ
            </span>
          </div>
        ) : (
          <button type="button" className="button button--big" onClick={registry.hireAction}>
            Нанять Старого Тимоху
          </button>
        )}
        <p className="offer__fine">
          {hired
            ? "Миндалиновая связь подтверждена. Выходят завтра. Оба. На одну ставку."
            : "Нажимая кнопку, вы соглашаетесь платить одну зарплату на двоих."}
        </p>
      </div>
    </section>
  );
};

export { Offer };
