import { randomUUID } from "node:crypto";

// css module processor - found not used css vars
const notUtilizedCssVarsProcessor =
  (availableCssVars) => {
    // maybe parse ?

    const id = randomUUID();

    const fileExt = "module.css";

    const fileHandler = async (path) => {
      // read file by path
      // read file content
      // find utilized css variables
      // intersect with available
    };

    return {
      id,
      fileExt,
      fileHandler,
    };
  };

const traverseFolder = (path, processors) => {
  // recursively traverse it
};

