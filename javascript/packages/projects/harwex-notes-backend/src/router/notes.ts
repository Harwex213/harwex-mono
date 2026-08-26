import { TRPCError } from "@trpc/server";
import {
  createNoteInputSchema,
  noteByIdInputSchema,
  updateNoteInputSchema,
} from "@hw/harwex-notes-protocol";
import { publicProcedure, router } from "../trpc.js";
import { createNote, deleteNote, getNote, listNotes, updateNote } from "../notesStore.js";

const notesRouter = router({
  list: publicProcedure.query(() => {
    return listNotes();
  }),
  byId: publicProcedure.input(noteByIdInputSchema).query(({ input }) => {
    const note = getNote(input.id);
    if (!note) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return note;
  }),
  create: publicProcedure.input(createNoteInputSchema).mutation(({ input }) => {
    return createNote(input);
  }),
  update: publicProcedure.input(updateNoteInputSchema).mutation(({ input }) => {
    const note = updateNote(input.id, input.patch);
    if (!note) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return note;
  }),
  delete: publicProcedure.input(noteByIdInputSchema).mutation(({ input }) => {
    if (!deleteNote(input.id)) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return { id: input.id };
  }),
});

export { notesRouter };
