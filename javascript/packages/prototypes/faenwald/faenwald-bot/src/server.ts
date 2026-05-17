import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import VkBot from "node-vk-bot-api";
import { calculateSanitaryLosses } from "./core/calculate-sanitary-losses.js";

const __dirname = join(dirname(fileURLToPath(import.meta.url)), "..");
const __env = join(__dirname, ".env");

const envFromFile = readFileSync(__env, "utf8").toString().split("\n").reduce<Record<string, any>>((envs, examined) => {
    const [key, value] = examined.trim().split("=");
    envs[key] = value;
    return envs;
}, {});
process.env = {
    ...process.env,
    ...envFromFile,
};

const bot = new VkBot({
    token: process.env.VK_ACCESS_TOKEN!,
    execute_timeout: 500,
    polling_timeout: 25,
});

const handleDice = (_: string): string => {
    return "Орбис сказал — " + Math.trunc(Math.random() * 20 + 1);
};

const handleSanitaryLosses = (text: string): string => {
    const omit = text.match(/орбис посчитай потери/)![0];
    const input = text.slice(omit.length);
    const result = calculateSanitaryLosses(input);

    return "Орбис посчитал!\n\n" + result;
}

const COMMANDS = [
    {
        command: /орбис (\d*)[dд](\d+)/i,
        handler: handleDice,
    },
    {
        command: /орбис посчитай потери/i,
        handler: handleSanitaryLosses,
    }
];

bot.event("message_new", (ctx) => {
    console.log(ctx.message);

    const command = COMMANDS.find((command) => {
        return ctx.message.text?.match(command.command) !== null;
    });

    if (command && ctx.message.text) {
        try {
            ctx.reply(command.handler(ctx.message.text));
        } catch (e) {
            if (e instanceof Error) {
                ctx.reply(e.message);
            } else {
                ctx.reply("Орбис умер. СРОЧНО НАПИШИТЕ СОЗДАТЕЛЮ.");
            }
        }
    }
});

bot.startPolling((err) => {
    console.log(err);

    return {};
});
