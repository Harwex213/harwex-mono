// The 256px cuts of the portraits, not the 1254px masters beside them. Nothing
// draws a portrait larger than 76px, and a master costs the browser 15-50ms to
// decode — a frame or three, taken while a card is on the move. The masters are
// kept where they are; regenerate a cut with
// `sips -s format png -Z 256 01-lko.png --out 01-lko-256.png`.
import lko from "../../assets/units-avatars/01-lko-256.png";
import sko from "../../assets/units-avatars/02-sko-256.png";
import tko from "../../assets/units-avatars/03-tko-256.png";
import lpo from "../../assets/units-avatars/04-lpo-256.png";
import spo from "../../assets/units-avatars/05-spo-256.png";
import tpo from "../../assets/units-avatars/06-tpo-256.png";
import lka from "../../assets/units-avatars/07-lka-256.png";
import ska from "../../assets/units-avatars/08-ska-256.png";
import tka from "../../assets/units-avatars/09-tka-256.png";
import luch from "../../assets/units-avatars/10-luch-256.png";
import kluch from "../../assets/units-avatars/11-kluch-256.png";
import long from "../../assets/units-avatars/12-long-256.png";
import arb from "../../assets/units-avatars/13-arb-256.png";

// Short code of every unit type that has a portrait. A roster is typed against
// this, so a unit can only carry a code the map below answers. Инж has a prompt
// in `assets/units-avatars-prompts` but no picture yet, so it is not here.
type AvatarCode =
  | "ЛКо"
  | "СКо"
  | "ТКо"
  | "ЛПо"
  | "СПо"
  | "ТПо"
  | "ЛКа"
  | "СКа"
  | "ТКа"
  | "Луч"
  | "КЛуч"
  | "Лонг"
  | "Арб";

// Portraits from `assets/units-avatars`. One per unit type, shared by both
// armies: which side a unit fights for is read off the frame around the
// portrait, never off the picture itself.
const UNIT_AVATARS: Record<AvatarCode, string> = {
  "ЛКо": lko,
  "СКо": sko,
  "ТКо": tko,
  "ЛПо": lpo,
  "СПо": spo,
  "ТПо": tpo,
  "ЛКа": lka,
  "СКа": ska,
  "ТКа": tka,
  "Луч": luch,
  "КЛуч": kluch,
  "Лонг": long,
  "Арб": arb,
};

export { UNIT_AVATARS };
export type { AvatarCode };
