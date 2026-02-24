type TBonusModifierPropertyTypeDomainEconomy = {
  type: "domain-economy";
  value: |
    "population" |
    "populationGrowthRate" |
    "turnover" |
    "turnoverGrowthRate" |
    "collectionEfficiency" |
    "suzerainTaxRate" |
    "imperialTaxRate";
};

const bonusModifierPropertyTypeDomainEconomy = (value: TBonusModifierPropertyTypeDomainEconomy["value"]) => value;

type TBonusModifierPropertyTypeVassalEconomy = {
  type: "vassal-economy";
  value: |
    "population" |
    "populationGrowthRate" |
    "turnover" |
    "turnoverGrowthRate" |
    "collectionEfficiency" |
    "suzerainTaxRate" |
    "imperialTaxRate";
};

const bonusModifierPropertyTypeVassalEconomy = (value: TBonusModifierPropertyTypeVassalEconomy["value"]) => value;

type TBonusModifierPropertyTypeDynastyFeudalism = {
  type: "dynasty-feudalism";
  value: "imperialPoints";
};

const bonusModifierPropertyTypeDynastyFeudalism = (value: TBonusModifierPropertyTypeDynastyFeudalism["value"]) => value;

type TBonusModifierPropertyTypeTechnology = {
  type: "technology";
  value: "technologyPoints";
};

const bonusModifierPropertyTypeTechnology = (value: TBonusModifierPropertyTypeTechnology["value"]) => value;

type TBonusModifierType = "percent" | "value";

const bonusModifierType = (value: TBonusModifierType) => value;

type TBonusModifier = {
  property: |
    TBonusModifierPropertyTypeDomainEconomy |
    TBonusModifierPropertyTypeVassalEconomy |
    TBonusModifierPropertyTypeDynastyFeudalism |
    TBonusModifierPropertyTypeTechnology;

  type: TBonusModifierType;

  value: number;

  duration: number | null;
};

const bonusModifierPropertyType = (
  value: |
    TBonusModifierPropertyTypeDomainEconomy["type"] |
    TBonusModifierPropertyTypeVassalEconomy["type"] |
    TBonusModifierPropertyTypeDynastyFeudalism["type"] |
    TBonusModifierPropertyTypeTechnology["type"]
) => value;

type TBonus = {
  /** > 0 */
  id: number;

  name: string;

  modifiers: TBonusModifier[];
}

export type {
  TBonus,
};
export {
  bonusModifierType,
  bonusModifierPropertyType,
  bonusModifierPropertyTypeDomainEconomy,
  bonusModifierPropertyTypeVassalEconomy,
  bonusModifierPropertyTypeDynastyFeudalism,
  bonusModifierPropertyTypeTechnology,
};
