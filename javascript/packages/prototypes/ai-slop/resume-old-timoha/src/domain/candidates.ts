import stary from "../assets/stary.jpg";
import timoha from "../assets/timoha.jpg";

type TCandidateId = "timoha" | "stary";

type TFact = {
  label: string;
  value: string;
  note?: string;
};

type TCandidate = {
  id: TCandidateId;
  name: string;
  codename: string;
  photo: string;
  // The accent colour of the candidate: Тимоха is cyan, Старый is magenta.
  accent: "cyan" | "magenta";
  tagline: string;
  facts: TFact[];
  quote?: string;
  stats: { label: string; value: number }[];
};

const TIMOHA: TCandidate = {
  id: "timoha",
  name: "Тимоха",
  codename: "UNIT-14 // CEO.EXE",
  photo: timoha,
  accent: "cyan",
  tagline: "Будущий генеральный директор всего направления айти",
  facts: [
    { label: "Школа", value: "Средне образовательная школа №14" },
    { label: "Колледж", value: "Типа политех «Успех»" },
    { label: "Через 5 лет", value: "Генеральный директор всего направления айти" },
    { label: "Языки", value: "Русский, белорусский", note: "английский — хуёво" },
    { label: "Программирование", value: "HTML и Pascal", note: "IDE: Блокнот" },
    { label: "Позиция", value: "Хьюман ресурс менеджмент" },
    { label: "Вдохновляется", value: "Илон Маск" },
    { label: "Последняя книга", value: "«Богатый Вася, Бедный Вася»", note: "книжки не читаю" },
  ],
  quote: "Лучше хуем бить орехи, чем учиться в политехе",
  stats: [
    { label: "Амбиции", value: 100 },
    { label: "Блокнот-кодинг", value: 87 },
    { label: "Английский", value: 12 },
    { label: "Чтение книг", value: 3 },
  ],
};

const STARY: TCandidate = {
  id: "stary",
  name: "Старый",
  codename: "UNIT-32 // GROCERY.SYS",
  photo: stary,
  accent: "magenta",
  tagline: "Будущий работник продуктового",
  facts: [
    { label: "Школа", value: "Классная супер школа №32" },
    { label: "Колледж", value: "МРК", note: "не ядерная ракета" },
    { label: "Через 5 лет", value: "Работник продуктового" },
    { label: "Языки", value: "Много знает", note: "в особенности на нигерском" },
    { label: "Программирование", value: "[ЗАСЕКРЕЧЕНО]" },
    { label: "Позиция", value: "Хьюман ресурс менеджмент" },
    { label: "Вдохновляется", value: "Фредди Крюгер" },
    { label: "Последняя книга", value: "Мануал по управлению машиной" },
  ],
  stats: [
    { label: "Полиглотия", value: 96 },
    { label: "Стабильность", value: 99 },
    { label: "Видимость глаз", value: 4 },
    { label: "Жуть", value: 88 },
  ],
};

const CANDIDATES = [TIMOHA, STARY];

const SYNERGY = 5;

export type { TCandidate, TCandidateId, TFact };
export { CANDIDATES, STARY, SYNERGY, TIMOHA };
