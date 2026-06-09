import fs from "fs";
import { TClash, THouse } from "@/types.js";

const ROUND = 5;
const CLASH_ID = 1;

type TContext = { houses: THouse[], clashes: TClash[] };

const getFinalDice = ({ houses, clashes }: TContext) => {
    let output = "";

    const clash = clashes.find((it) => it.clashId === CLASH_ID)!;

    const {
        firstKnightId,
        secondKnightId,
        dices,
        firstKnightPointsAllocation,
        secondKnightPointsAllocation,
    } = clash;

    const firstKnightHouse = houses.find((house) => house.dynasty === firstKnightId)!;
    const secondKnightHouse = houses.find((house) => house.dynasty === secondKnightId)!;

    output += `${clash.clashId}) ${firstKnightHouse.dynasty.toLocaleUpperCase()}, @${firstKnightHouse.playerId} (${firstKnightHouse.knight}) ПРОТИВ ${secondKnightHouse.dynasty.toLocaleUpperCase()}, @${secondKnightHouse.playerId} (${secondKnightHouse.knight})\n`;

    const dicesText = dices.map((diceRound) => {
        const {
            firstKnightAttackType,
            firstKnightDice,
            secondKnightAttackType,
            secondKnightDice,
        } = diceRound;

        let firstKnightFromPointsAllocation = 0;
        let secondKnightFromPointsAllocation = 0;

        if (firstKnightAttackType === 1) {
            firstKnightFromPointsAllocation = firstKnightPointsAllocation.attackLeg - secondKnightPointsAllocation.defenseLeg;
        }
        if (firstKnightAttackType === 2) {
            firstKnightFromPointsAllocation = firstKnightPointsAllocation.attackArms - secondKnightPointsAllocation.defenseArms;
        }
        if (firstKnightAttackType === 3) {
            firstKnightFromPointsAllocation = firstKnightPointsAllocation.attackBody - secondKnightPointsAllocation.defenseBody;
        }
        if (secondKnightAttackType === 1) {
            secondKnightFromPointsAllocation = secondKnightPointsAllocation.attackLeg - firstKnightPointsAllocation.defenseLeg;
        }
        if (secondKnightAttackType === 2) {
            secondKnightFromPointsAllocation = secondKnightPointsAllocation.attackArms - firstKnightPointsAllocation.defenseArms;
        }
        if (secondKnightAttackType === 3) {
            secondKnightFromPointsAllocation = secondKnightPointsAllocation.attackBody - firstKnightPointsAllocation.defenseBody;
        }

        const firstKnightFinalDice = firstKnightDice + firstKnightFromPointsAllocation;
        const secondKnightFinalDice = secondKnightDice + secondKnightFromPointsAllocation;

        return `ПЕРВЫЙ: ${firstKnightFinalDice}. ВТОРОЙ: ${secondKnightFinalDice}`;
    });

    console.log(output);
    console.log(dicesText);
    console.log("\n");
};

const printParticipants = ({ houses, clashes }: TContext) => {
    let output = "";
    for (const clash of clashes) {
        const {
            firstKnightId,
            secondKnightId,
        } = clash;

        const firstKnightHouse = houses.find((house) => house.dynasty === firstKnightId)!;
        const secondKnightHouse = houses.find((house) => house.dynasty === secondKnightId)!;

        output += `${clash.clashId}) ${firstKnightHouse.dynasty.toLocaleUpperCase()}, @${firstKnightHouse.playerId} (${firstKnightHouse.knight}). ПРОТИВ. ${secondKnightHouse.dynasty.toLocaleUpperCase()}, @${secondKnightHouse.playerId} (${secondKnightHouse.knight})\n`;
    }

    console.log(output);
    console.log("\n");
}

const main = () => {
    const houses = JSON.parse(fs.readFileSync("../data/houses.json").toString()) as THouse[];
    const clashes = JSON.parse(fs.readFileSync(`../data/round-${ROUND}.json`).toString()) as TClash[];

    const ctx = { houses, clashes };

    // printParticipants(ctx);

    getFinalDice(ctx);
};

main();