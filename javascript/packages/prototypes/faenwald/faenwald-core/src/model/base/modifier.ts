export type TModifierSource = "system" | "custom";

export type TModifierImplication<Property> = {
  modifierProperty: Property;
  modifierType: "percent" | "value";
  modifierValue: number;
}
