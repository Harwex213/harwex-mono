import type { TTechId, TTechInfo } from "./types";

/** The eight technologies of plan §3.3. One is researched at a time. */

/** Prerequisites first, so a list rendered in this order never draws an arrow backwards. */
const TECH_ORDER: readonly TTechId[] = [
  "irrigation",
  "scrubbers",
  "deep_shafts",
  "star_charts",
  "asylum",
  "conscription",
  "levitation",
  "purge_ritual",
];

const TECHS: Readonly<Record<TTechId, TTechInfo>> = {
  irrigation: {
    id: "irrigation",
    nameRu: "Ирригация",
    cost: 20,
    requires: [],
    descriptionRu: "Каждая ферма даёт на 1 еды больше.",
  },
  scrubbers: {
    id: "scrubbers",
    nameRu: "Скрубберы",
    cost: 30,
    requires: [],
    descriptionRu: "Каждая постройка добавляет на 1 токсичности меньше, но не меньше нуля.",
  },
  deep_shafts: {
    id: "deep_shafts",
    nameRu: "Глубокие шахты",
    cost: 30,
    requires: ["scrubbers"],
    descriptionRu: "Каждый рудник даёт на 2 камня больше и на 1 токсичности больше.",
  },
  star_charts: {
    id: "star_charts",
    nameRu: "Звёздные карты",
    cost: 35,
    requires: [],
    descriptionRu: "Каждая обсерватория даёт на 1 разведки больше, а вскрытие клетки мира стоит 1 разведки вместо 2.",
  },
  asylum: {
    id: "asylum",
    nameRu: "Лечебница",
    cost: 40,
    requires: ["irrigation"],
    descriptionRu: "Успокоить лечит 3 сумасшедших за применение и стоит 2 маны.",
  },
  conscription: {
    id: "conscription",
    nameRu: "Рекрутский набор",
    cost: 45,
    requires: ["irrigation"],
    descriptionRu: "Каждая деревня даёт ещё одного ополченца, а все отряды получают 10 здоровья.",
  },
  levitation: {
    id: "levitation",
    nameRu: "Левитация",
    cost: 60,
    requires: ["star_charts"],
    descriptionRu: "Остров пролетает 2 клетки мира за ход вместо одной.",
  },
  purge_ritual: {
    id: "purge_ritual",
    nameRu: "Ритуал очищения",
    cost: 80,
    requires: ["asylum", "scrubbers"],
    descriptionRu: "Действие: потратить 5 маны и снять 20 токсичности с одного гекса.",
  },
};

/** True when every prerequisite of the tech is already researched. */
const isTechAvailable = (tech: TTechId, researched: readonly TTechId[]): boolean => {
  if (researched.includes(tech) === true) {
    return false;
  }
  return TECHS[tech].requires.every((required) => {
    return researched.includes(required);
  });
};

export { TECHS, TECH_ORDER, isTechAvailable };
