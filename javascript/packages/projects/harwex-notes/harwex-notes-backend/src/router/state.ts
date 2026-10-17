import {
  nodeStateInputSchema,
  setNodeStateInputSchema,
  setSettingInputSchema,
  settingInputSchema,
  treeStateSchema,
} from "@hw/harwex-notes-protocol";
import { publicProcedure, router } from "../trpc.js";
import {
  fetchNodeState,
  fetchSetting,
  fetchSettings,
  fetchTreeState,
  saveNodeState,
  saveSetting,
  saveTreeState,
} from "../service/state-service.js";

// tRPC serialises a `void` output to `never` on the client, so every mutation answers with
// an explicit `null`. A read of a missing row answers `null` too.
const stateRouter = router({
  tree: publicProcedure.query(({ ctx }) => {
    return fetchTreeState(ctx);
  }),
  setTree: publicProcedure.input(treeStateSchema).mutation(({ ctx, input }) => {
    saveTreeState(ctx, input);

    return null;
  }),
  getNodeState: publicProcedure.input(nodeStateInputSchema).query(({ ctx, input }) => {
    return fetchNodeState(ctx, input.path, input.key);
  }),
  setNodeState: publicProcedure.input(setNodeStateInputSchema).mutation(({ ctx, input }) => {
    saveNodeState(ctx, input.path, input.key, input.value);

    return null;
  }),
  settings: publicProcedure.query(({ ctx }) => {
    return fetchSettings(ctx);
  }),
  getSetting: publicProcedure.input(settingInputSchema).query(({ ctx, input }) => {
    return fetchSetting(ctx, input.key);
  }),
  setSetting: publicProcedure.input(setSettingInputSchema).mutation(({ ctx, input }) => {
    saveSetting(ctx, input.key, input.value);

    return null;
  }),
});

export { stateRouter };
