import fs from "fs";

type TFootDuel = {
    clashId: string;
    firstKnight: string;
    secondKnight: string;
    firstKnightPlayer: string;
    secondKnightPlayer: string;
}

const TRANSLATE: Record<number, string> = {
    1: "ПЕРВЫЙ",
    2: "ВТОРОЙ",
    3: "ТРЕТИЙ",
    4: "ЧЕТВЕРТЫЙ",
    5: "ПЯТЫЙ",
}

const main = () => {
    let output = "";
    const data = JSON.parse(fs.readFileSync("../data/foot-duels.json").toString()) as TFootDuel[][];

    for (let i = 0; i < data.length; i++) {
        output += `ТУРНИР ${TRANSLATE[i + 1]}\n\n`;
        for (const knight of data[i]) {
            output += `@${knight.firstKnightPlayer} (${knight.firstKnight}) против @${knight.secondKnightPlayer} (${knight.secondKnight})\n`;
        }
        output += `\n`;
    }

    console.log(output);
}

main();