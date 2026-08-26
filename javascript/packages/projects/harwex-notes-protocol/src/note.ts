import { z } from "zod";

const noteIdSchema = z.string().min(1);

const noteSchema = z.object({
  id: noteIdSchema,
  title: z.string().min(1).max(200),
  content: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const createNoteInputSchema = noteSchema.pick({
  title: true,
  content: true,
});

const updateNoteInputSchema = z.object({
  id: noteIdSchema,
  patch: createNoteInputSchema.partial(),
});

const noteByIdInputSchema = z.object({
  id: noteIdSchema,
});

type NoteId = z.infer<typeof noteIdSchema>;
type Note = z.infer<typeof noteSchema>;
type CreateNoteInput = z.infer<typeof createNoteInputSchema>;
type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;
type NoteByIdInput = z.infer<typeof noteByIdInputSchema>;

export {
  noteIdSchema,
  noteSchema,
  createNoteInputSchema,
  updateNoteInputSchema,
  noteByIdInputSchema,
};
export type { NoteId, Note, CreateNoteInput, UpdateNoteInput, NoteByIdInput };
