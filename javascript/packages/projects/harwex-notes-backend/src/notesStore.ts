import type { CreateNoteInput, Note, NoteId } from "@hw/harwex-notes-protocol";

const notes = new Map<NoteId, Note>();

function listNotes(): Note[] {
  return [...notes.values()];
}

function getNote(id: NoteId): Note | undefined {
  return notes.get(id);
}

function createNote(input: CreateNoteInput): Note {
  const now = new Date().toISOString();
  const note: Note = {
    id: crypto.randomUUID(),
    title: input.title,
    content: input.content,
    createdAt: now,
    updatedAt: now,
  };
  notes.set(note.id, note);
  return note;
}

function updateNote(id: NoteId, patch: Partial<CreateNoteInput>): Note | undefined {
  const existing = notes.get(id);
  if (!existing) {
    return undefined;
  }
  const updated: Note = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  notes.set(id, updated);
  return updated;
}

function deleteNote(id: NoteId): boolean {
  return notes.delete(id);
}

export { listNotes, getNote, createNote, updateNote, deleteNote };
