export type TPointsAllocation = {
    attackLeg: number;
    attackArms: number;
    attackBody: number;
    defenseLeg: number;
    defenseArms: number;
    defenseBody: number;
};

export type THouse = {
    id: number;
    answer: string;
    knight: string;
    dynasty: string;
    playerId: string;
    footDuels: boolean;
    willChangePointsAllocation: boolean;
    chosenLady: string;
    health: string;
    pointsAllocation: TPointsAllocation;
};

export type TClashDice = {
    firstKnightAttackType: number;
    firstKnightDice: number;
    firstKnightFinalDice: number;
    secondKnightAttackType: number;
    secondKnightDice: number;
    secondKnightFinalDice: number;
}

export type TClash = {
    clashId: number;
    firstKnightId: string;
    firstKnightPointsAllocation: TPointsAllocation;
    secondKnightId: string;
    secondKnightPointsAllocation: TPointsAllocation;
    dices: TClashDice[];
};
