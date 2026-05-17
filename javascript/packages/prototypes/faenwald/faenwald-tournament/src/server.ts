import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import VkBot from "node-vk-bot-api";

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
    polling_timeout: 500,
});

bot.command("орбис д20", (ctx) => {
    console.log(ctx.message);

    ctx.reply("Орбис сказал — " + Math.trunc(Math.random() * 20 + 1));
});

bot.startPolling((err) => {
    console.log(err);

    return {};
});

// type TVkRequest = {
//     "group_id": number;
//     "type": "message_new";
//     "event_id": "string";
//     "v": "string";
//     "object": {
//         "client_info": {
//             "button_actions": string[];
//             "keyboard": boolean;
//             "inline_keyboard": boolean;
//             "carousel": boolean;
//             "lang_id": number;
//         },
//         "message": {
//             "date": number;
//             "from_id": number;
//             "id": number;
//             "version": number;
//             "out": number;
//             "fwd_messages": string[];
//             "important": boolean;
//             "is_hidden": boolean;
//             "attachments": string[];
//             "conversation_message_id": string;
//             "text": string;
//             "peer_id": number;
//             "random_id": number;
//         }
//     },
//     "secret": string;
// };
//
// const isVkNewMessage = (requestMessage: unknown): requestMessage is TVkRequest => {
//     if (requestMessage === null || typeof requestMessage !== "object" || Object.getPrototypeOf(requestMessage) !== Object.prototype) {
//         return false;
//     }
//
//     return "type" in requestMessage && requestMessage.type === "message_new";
// }
//
// const processMessage = (requestMessage: unknown) => {
//     const isValid = isVkNewMessage(requestMessage);
//     if (!isValid) {
//         return;
//     }
//
//     const userId = requestMessage.object.message.from_id;
//     const message = requestMessage.object.message.text;
//
//     if (message.toLocaleLowerCase() === "орбис д20") {
//         const message = "Орбис сказал — " + Math.trunc(Math.random() * 20 + 1);
//
//         void sendRequest(userId, message);
//     }
// }

// const server = http.createServer((incomingMessage, response) => {
//     let data = "";
//     incomingMessage.on("data", (chunk: any) => {
//         data += chunk;
//     });
//     incomingMessage.on("end", () => {
//         console.log("New request: ", data);
//
//         processMessage(JSON.parse(data));
//
//         response.writeHead(200, { "Content-Type": "text/plain" });
//         response.end("4bf12c6a");
//     });
// });
//
// server.listen(8080, () => {
//     console.log("Server started on port 8080");
// });

// const sendRequest = async (userId: number, message: string): Promise<void> => {
//     const params = new URLSearchParams();
//     params.set("v", "5.199");
//     params.set("user_id", userId.toString());
//     params.set("random_id", Math.trunc(Math.random() * 2147483647 + 1).toString());
//     params.set("access_token", process.env.VK_ACCESS_TOKEN!);
//     params.set("message", message);
//
//     const response = await request("https://api.vk.ru/method/messages.send", {
//         method: "POST",
//         body: params.toString(),
//         headers: {
//             "Content-Type": "application/x-www-form-urlencoded",
//         }
//     });
//
//     const data = await response.body.text();
//
//     console.log("Response Vk: ", data);
// }
