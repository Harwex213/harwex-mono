import { createStore } from "./store.js";
import { createInitialState } from "./state/counter.js";
import { createCounter } from "./components/counter.js";

const store = createStore(createInitialState());

const counter = createCounter({ store });

document.querySelector("#app").append(counter.el);
