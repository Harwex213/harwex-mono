import fs from "fs";
import { THouse } from "@/types.js";

const text = [
    "К вам прибыл гонец дома Аэтериан. Пришло время турнира!",
    "",
    "",
    "Освежить правила турнира в памяти - https://vk.com/@-236535716-imperskii-turnir-v-triahsise-130-ot-pnk. Прошу от вас следующих действий",
    "1) Известный на текущий момент рыцарь, выступающий от имени '{{dynasty}}' - {{knight}}. Поправьте ланцената, если это не так и напишите кто от имени вашего дома будет выступать на самом деле.",
    "2) Присоединиться к чату турнира - https://vk.me/join/1CNv887sySx/ARuIND96RRYvqni/N6MbweQ=",
    "3) Прислать скрин вашего рыцаря (опционально)",
    "4) Сообщить какую даму турнира вы выбираете: 1) Эриадну фон Стриве, жену ланцената; 2) Миравен Лунеталь, наследницу Айвен Лунеталь; 3) Элриндель Виноир, жену рейхсканцлера; 4) Пенелопа из дома Лемонис, сестру великого виконта Великого Культурноса.",
    "5) Сказать будете ли менять очки по ходу турнира или выберете один раз?",
    "6) Хотите ли участвовать в первичных пеших дуэлях?",
    "7) Прислать бонусы к очкам у вашего рыцаря и их источник",
    "8) Написать сообщение в это (https://vk.com/club236535716) сообщество с тем, как вы распределяете очки на вашу первую дуэль. Присылайте её в формате:",
    "АТАКА НОГИ: N",
    "АТАКА РУКИ : N",
    "АТАКА ТЕЛО: N",
    "ЗАЩИТА НОГИ: N",
    "ЗАЩИТА РУКИ: N",
    "ЗАЩИТА ТЕЛО: N",
].join("\n");

const TOKENS: Record<string, keyof THouse> = {
    "{{dynasty}}": "dynasty",
    "{{knight}}": "knight",
}

const main = () => {
    let output = "";
    const data = JSON.parse(fs.readFileSync("../data/houses.json").toString()) as THouse[];

    for (const house of data) {
        let personalText = text;

        for (const token in TOKENS) {
            personalText = personalText.replace(token, house[TOKENS[token]].toString());
        }

        output += "--------\n";
        output += `https://vk.com/${house.playerId}\n`;
        output += "--------\n";
        output += personalText + "\n";
        output += "--------\n\n";
    }

    fs.writeFileSync("../data/invitation.txt", output);
}

main();