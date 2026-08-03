import lko from "../../assets/units-avatars/01-lko.png";
import sko from "../../assets/units-avatars/02-sko.png";
import tko from "../../assets/units-avatars/03-tko.png";
import lpo from "../../assets/units-avatars/04-lpo.png";

// Short code of every unit type that has a portrait. A roster is typed against
// this, so a unit can only carry a code the map below answers.
type AvatarCode = "ЛКо" | "СКо" | "ТКо" | "ЛПо";

// Portraits from `assets/units-avatars`. One per unit type, shared by both
// armies: which side a unit fights for is read off the frame around the
// portrait, never off the picture itself.
const UNIT_AVATARS: Record<AvatarCode, string> = {
  "ЛКо": lko,
  "СКо": sko,
  "ТКо": tko,
  "ЛПо": lpo,
};

export { UNIT_AVATARS };
export type { AvatarCode };
