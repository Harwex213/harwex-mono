import {
  CREDIT_RATINGS,
  type EconomySnapshot,
  type Sector,
  type SectorKind,
} from "../../../domain/index";
import {
  formatAmount,
  formatBalance,
  formatGrowth,
  formatPercent,
  trendOf,
} from "./format";
import styles from "./country-sheet.module.css";

// The economy tab: the calculator result for one year. Display only.

// Short names fit the row; the full name shows on hover.
const SECTOR_TITLES: Record<SectorKind, { short: string; full: string }> = {
  agriculture: { short: "Сельское х-во", full: "Сельское хозяйство" },
  lightIndustry: { short: "Лёгкая пром.", full: "Лёгкая промышленность" },
  heavyIndustry: { short: "Тяжёлая пром.", full: "Тяжёлая промышленность" },
  commerce: { short: "Коммерция", full: "Коммерческий сектор" },
  extraction: { short: "Добыча", full: "Добывающий сектор" },
  other: { short: "Иное", full: "Иное" },
};

function sectorTitle(sector: Sector): { short: string; full: string } {
  if (sector.kind === "other" && sector.title !== "") {
    return { short: sector.title, full: sector.title };
  }
  return SECTOR_TITLES[sector.kind];
}

// The side of the state control scale: up to 50 leans to planning, above 50 to the market.
function controlLeaning(value: number): string {
  if (value < 50) {
    return "плановая";
  }
  if (value > 50) {
    return "рыночная";
  }
  return "нейтральная";
}

function EconomyTab({ economy }: { economy: EconomySnapshot }) {
  const sectorTotal = economy.sectors.reduce((sum, sector) => {
    return sum + sector.volume;
  }, 0);

  return (
    <div className={styles.tabBody} aria-label="economy">
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Экономика · {economy.year}</h3>
        <div className={styles.headline}>
          <span className={styles.label}>ВВП</span>
          <span className={styles.figure}>{formatAmount(economy.gdp)} млн</span>
          <span className={styles.trend} data-trend={trendOf(economy.growthPct)}>
            {formatGrowth(economy.growthPct)}
          </span>
        </div>
        <div className={styles.headline}>
          <span className={styles.label}>Кредитный рейтинг</span>
          <span className={styles.ratings}>
            {CREDIT_RATINGS.map((rating) => {
              return (
                <span
                  className={styles.rating}
                  data-active={rating === economy.creditRating ? "true" : "false"}
                  key={rating}
                >
                  {rating}
                </span>
              );
            })}
          </span>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Сектора</h3>
        {economy.sectors.length === 0 ? <p className={styles.empty}>нет данных</p> : null}
        {economy.sectors.map((sector, at) => {
          const share = sectorTotal > 0 ? (sector.volume / sectorTotal) * 100 : 0;
          const title = sectorTitle(sector);
          return (
            <div className={styles.sector} key={sector.kind + at}>
              <span className={styles.sectorName} title={title.full}>{title.short}</span>
              <span className={styles.bar}>
                <span className={styles.barFill} style={{ width: share + "%" }} />
              </span>
              <span className={styles.share}>{formatPercent(Math.round(share))}</span>
              <span className={styles.trend} data-trend={trendOf(sector.growthPct)}>
                {formatGrowth(sector.growthPct)}
              </span>
            </div>
          );
        })}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Государственный контроль</h3>
        <div className={styles.scale}>
          <span className={styles.scaleEnd}>план</span>
          <span className={styles.scaleTrack}>
            <span className={styles.scaleMiddle} />
            <span className={styles.scaleMarker} style={{ left: economy.stateControl + "%" }} />
          </span>
          <span className={styles.scaleEnd}>рынок</span>
        </div>
        <p className={styles.caption}>
          {economy.stateControl} из 100 · {controlLeaning(economy.stateControl)} экономика
        </p>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Расходные очки</h3>
        <div className={styles.points}>
          <span className={styles.label}>ФС</span>
          <span className={styles.figure}>{formatAmount(economy.fs)}</span>
          <span className={styles.label}>резерв</span>
          <span className={styles.figure}>{formatAmount(economy.fsReserve)}</span>
          <span className={styles.label}>ВПК</span>
          <span className={styles.figure}>{formatAmount(economy.vpk)}</span>
          <span className={styles.label}>склад</span>
          <span className={styles.figure}>{formatAmount(economy.vpkStockpile)}</span>
          <span className={styles.label}>Эмиссия</span>
          <span className={styles.figure}>{formatPercent(economy.emissionPct)}</span>
          <span className={styles.label}>Военные расходы</span>
          <span className={styles.figure}>{formatPercent(economy.militarySpendingPct)}</span>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Ресурсы за ход</h3>
        {economy.resources.length === 0 ? <p className={styles.empty}>нет данных</p> : null}
        <div className={styles.resources}>
          {economy.resources.map((resource) => {
            return (
              <div className={styles.resource} key={resource.title}>
                <span className={styles.resourceName}>{resource.title}</span>
                <span className={styles.trend} data-trend={trendOf(resource.balance)}>
                  {formatBalance(resource.balance)}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export { EconomyTab };
