import { generateHEX } from "@hw/utils";

const root = document.getElementById("root");

const canvas = document.createElement("canvas");
canvas.width = root.clientWidth;
canvas.height = root.clientHeight;
root.appendChild(canvas);

const ctx = canvas.getContext("2d");
ctx.fillStyle = generateHEX();
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = "#c7d5e0";
ctx.font = "24px sans-serif";
ctx.fillText("Fantasy Map", 24, 48);
