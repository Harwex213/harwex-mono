import { startStudio } from "../../core/app";
import { LavaScene } from "./scene";

startStudio((gl) => new LavaScene(gl));
