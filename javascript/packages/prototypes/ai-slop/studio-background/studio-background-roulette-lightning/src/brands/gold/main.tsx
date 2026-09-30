import { startStudio } from "../../core/app";
import { GoldScene } from "./scene";

startStudio((gl) => new GoldScene(gl));
