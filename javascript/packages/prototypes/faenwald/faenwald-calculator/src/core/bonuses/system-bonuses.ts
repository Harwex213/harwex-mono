import {
  bonusModifierPropertyType,
  bonusModifierPropertyTypeTechnology, bonusModifierType,
  type TBonus,
} from "../dynasty-stats/bonuses.ts";

const REGIONAL_BONUS = {
  id: 10_000_000,
  name: "Благоразумие",
  modifiers: [
    {
      property: {
        type: bonusModifierPropertyType("technology"),
        value: bonusModifierPropertyTypeTechnology("technologyPoints"),
      },
      type: bonusModifierType("value"),
      value: ,
      duration: null,
    },
    {
      property: ,
      type: ,
      value: ,
      duration: null,
    },
  ],
} satisfies TBonus;
