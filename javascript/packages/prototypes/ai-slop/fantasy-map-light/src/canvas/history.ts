import type { ProvinceMeta } from "@/provinces/province-registry";

// Одно состояние редактора для Undo/Redo: пиксели слоя провинций + реестр
// провинций. Хранятся вместе, чтобы откат/повтор восстанавливали и картинку,
// и метаданные согласованно (имена провинций переживают Undo/Redo).
interface EditState {
    image: ImageData;
    provinces: ProvinceMeta[];
}

const MAX_HISTORY = 50;

// История правок с семантикой текстовых редакторов.
//
// Единица истории — один штрих: `begin()` фиксирует состояние ДО штриха,
// `commit()` записывает его в стек Undo (если штрих что-то изменил), `cancel()`
// отбрасывает (штрих ничего не нарисовал). `undo()`/`redo()` меняют местами
// текущее и сохранённое состояния. Новый `commit()` очищает ветку Redo.
class EditHistory {
    private undoStack: EditState[] = [];
    private redoStack: EditState[] = [];
    // Состояние, снятое на pointerdown; хранится до commit/cancel.
    private pending: EditState | null = null;

    // Фиксирует состояние ДО начала штриха.
    begin(state: EditState): void {
        this.pending = state;
    }

    // Завершает штрих: если он что-то изменил — состояние «до» уходит в Undo,
    // ветка Redo очищается (стандартная семантика).
    commit(changed: boolean): void {
        if (this.pending && changed) {
            this.undoStack.push(this.pending);
            if (this.undoStack.length > MAX_HISTORY) {
                this.undoStack.shift();
            }
            this.redoStack = [];
        }
        this.pending = null;
    }

    // Отбрасывает начатый штрих (ничего не нарисовано / вне карты).
    cancel(): void {
        this.pending = null;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    // Откат: текущее состояние уходит в Redo, возвращается предыдущее. null —
    // откатывать нечего (Undo при пустой истории ничего не делает).
    undo(current: EditState): EditState | null {
        const previous = this.undoStack.pop();
        if (!previous) {
            return null;
        }
        this.redoStack.push(current);
        return previous;
    }

    // Повтор: текущее состояние уходит в Undo, возвращается откатанное. null —
    // повторять нечего.
    redo(current: EditState): EditState | null {
        const next = this.redoStack.pop();
        if (!next) {
            return null;
        }
        this.undoStack.push(current);
        return next;
    }
}

export { EditHistory };
export type { EditState };
