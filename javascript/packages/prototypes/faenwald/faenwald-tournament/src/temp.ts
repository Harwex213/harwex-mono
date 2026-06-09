import fs from "fs";
import { THouse } from "@/types.js";

const main = () => {
    let output = "";
    const data = JSON.parse(fs.readFileSync("../data/houses.json").toString()) as THouse[];

    const housesFootDuels = data.filter((it) => it.footDuels);

    const houses = housesFootDuels.map((it) => it.dynasty).join("\n");

    output += "--------\n";
    output += `${houses}\n`;
    output += "--------\n";

    console.log(output);
}

main();