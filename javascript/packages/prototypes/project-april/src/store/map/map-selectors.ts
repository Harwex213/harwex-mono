import { computed } from "@preact/signals-react";
import { stateSignal } from "../internal/root-middleware.ts";

export const mapSignal = computed(() => stateSignal.value.map);

export const mapWidthSignal = computed(() => mapSignal.value.width);
export const mapHeightSignal = computed(() => mapSignal.value.height);
