const ws = new WebSocket("ws://localhost:8080");

ws.onopen = () => {
    console.log("Connected to the server");
};

ws.onmessage = (event) => {
    console.log("Received from server:", event.data);
    ws.close();
};

ws.onclose = () => {
    console.log("Disconnected from the server");
};