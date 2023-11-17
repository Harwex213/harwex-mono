class Storage {
    #entities = new Map();
    #subscribers = new Map();

    entities(entity) {
        return this.#entities.get(entity);
    }

    defineEntity(entity) {
        this.#entities.set(entity, []);
        this.#subscribers.set(entity, []);
    }

    subscribe(entity, onUpdate) {
        const subscribers = this.#subscribers.get(entity);
        subscribers.push(onUpdate);
    }

    unsubscribe(entity, onUpdate) {
        const subscribers = this.#subscribers.get(entity);
        const index = subscribers.indexOf(onUpdate);
        0 <= index && subscribers.splice(index, 1);

    }

    createEntity(entity, data) {
        const entities = this.#entities.get(entity);
        !!entities && entities.push(data);
    }

    updateEntity(entity, diff) {
        const entities = this.#entities.get(entity);
        if (!entities) {
            return;
        }

        const toUpdate = entities.find((it) => it.id === diff.id);
        if (!toUpdate) {
            return;
        }

        for (const key of Object.keys(diff)) {
            entity[key] = diff[key];
        }
    }

    deleteEntity(entity, id) {
        const entities = this.#entities.get(entity);
        if (!entities) {
            return;
        }

        const deletingIndex = entities.findIndex((it) => it.id === id);
        0 <= deletingIndex && entities.splice(deletingIndex, 1);
    }
}

export { Storage }