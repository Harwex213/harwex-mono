import pigeonKing from "../assets/pigeon-king.jpg";
import solderMaster from "../assets/solder-master.jpg";

type TTalent = {
  id: string;
  who: string;
  title: string;
  lead: string;
  photo: string;
  accent: "cyan" | "magenta";
  perks: { title: string; text: string }[];
};

const TALENTS: TTalent[] = [
  {
    id: "pigeon-king",
    who: "Тимоха",
    title: "Король Голубиной Жижи",
    lead: "Главный по голубиной жиже для электронки во всём районе. Голуби признали его власть и слетаются на пар.",
    photo: pigeonKing,
    accent: "cyan",
    perks: [
      { title: "Голуби в подчинении", text: "Личная гвардия из городских голубей. Доставляет резюме кандидатов быстрее почты." },
      { title: "Сомелье жижи", text: "Определяет вкус голубиной жижи с одной затяжки и с закрытыми глазами." },
      { title: "HR-применение", text: "Тимбилдинг в курилке проходит в облаке пара королевского уровня." },
    ],
  },
  {
    id: "solder-master",
    who: "Старый",
    title: "Мастер электроники",
    lead: "Паяет так, что заводится даже мёртвый дед. Паяльник в его руках работает как дефибриллятор.",
    photo: solderMaster,
    accent: "magenta",
    perks: [
      { title: "Пайка уровня некромантии", text: "Чинит всё, что проводит ток, и всё, что не проводит. Дед подтверждает." },
      { title: "Без схемы", text: "Схемы не читает. Мануал по управлению машиной — исключение." },
      { title: "HR-применение", text: "Перезапускает выгоревших сотрудников. Пульс появляется после второго касания паяльником." },
    ],
  },
];

export type { TTalent };
export { TALENTS };
