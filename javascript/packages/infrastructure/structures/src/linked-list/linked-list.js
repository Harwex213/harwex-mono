class LinkedList {
    first = null;
    last = null;
    count;

    constructor() {
        this.count = 0;
    }

    #createIndex(next, data) {
        return { next, data };
    }

    add(data) {
        if (this.count === 0) {
            this.first = this.#createIndex(null, data);
            this.last = this.first;
        } else {
            this.last.next = this.#createIndex(null, null);
            this.last = this.last.next;
            this.last.data = data;
        }

        this.count++;
    }

    at(index) {
        if (index + 1 > this.count || index < 0) {
            throw new Error("Wrong index for linked list dimension: [0, " + this.count + "]");
        }

        let currentIndex = 0;
        let current = this.first;
        while (currentIndex !== index && currentIndex !== null) {
            current = current.next;
            currentIndex++;
        }

        return current.data;
    }

    removeAt(index) {
        if (index + 1 > this.count || index < 0) {
            throw new Error("Wrong index for linked list dimension: [0, " + this.count + "]");
        }

        if (index === 0) {
            if (this.first.next === null) {
                this.first = null;
            } else {
                this.first = this.first.next;
            }

            this.count--;
            return;
        }

        let currentIndex = 0;
        let current = this.first;
        while (currentIndex !== index - 1) {
            current = current.next;
            currentIndex++;
        }

        current.next = current.next.next;
        this.count--;
    }

    toArray(array) {
        let current = this.first;

        for (let i = 0; i < array.length && current !== null; i++) {
            array[i] = current.data;
            current = current.next;
        }

        return array;
    }
}

export { LinkedList };
