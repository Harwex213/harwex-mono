import type { TPillarId } from "./pillars";

type TSlot = {
  pillar: TPillarId;
  from: number;
  to: number;
};

// Hours as fractions: 9.25 is 09:15. Everything outside the slots is "nothing".
const SCHEDULE: TSlot[] = [
  { pillar: "sleep", from: 0, to: 9 },
  { pillar: "poop", from: 9.25, to: 9.75 },
  { pillar: "eat", from: 10, to: 11 },
  { pillar: "sleep", from: 14, to: 15.5 },
  { pillar: "eat", from: 19, to: 20 },
  { pillar: "self", from: 22.5, to: 22.75 },
  { pillar: "sleep", from: 23.5, to: 24 },
];

const formatHour = (hour: number) => {
  const whole = Math.floor(hour) % 24;
  const minutes = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(whole).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const slotAt = (hour: number) => SCHEDULE.find((slot) => hour >= slot.from && hour < slot.to) ?? null;

export type { TSlot };
export { SCHEDULE, formatHour, slotAt };
