import "./inject-env.js";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { createInterface } from "node:readline/promises";
import { primaryAlgo } from "./chat-folder.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

const apiId = process.env.api_id;
const apiHash = process.env.api_hash;
const session = new StringSession(process.env.session_string);

const client = new TelegramClient(session, Number(apiId), apiHash, {
  connectionRetries: 5,
});

await client.start({
  phoneNumber: () => rl.question("Phone: "),
  password:    () => rl.question("2FA password: "),
  phoneCode:   () => rl.question("Code: "),
  onError: console.error,
});

console.log(await client.getMe());
console.log("Session string:", client.session.save());

await primaryAlgo(client);

rl.close();