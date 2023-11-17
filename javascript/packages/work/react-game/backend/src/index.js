import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const stringify = JSON.stringify;

const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(stringify({
        data: "Hello World!",
    }));
});

const wss = new WebSocketServer({ server });

wss.on("connection", function connection(ws) {
    ws.on("error", console.error);

    ws.on("message", function message(data) {
        console.log("received: %s", data);
    });

    ws.send(stringify({
        data: "Hello World!",
    }));
});

server.listen(8080);