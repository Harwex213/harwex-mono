class SetWithLocalStorage {
  #set;
  #key;

  constructor(key) {
    this.#key = key;
    this.#set = new Set(JSON.parse(localStorage.getItem(`breadthFirstSearch/${this.#key}`)));
  }

  has(examined) {
    return this.#set.has(examined);
  }

  values() {
    return this.#set.values();
  }

  add(examined) {
    this.#set.add(examined);
    localStorage.setItem(`breadthFirstSearch/${this.#key}`, JSON.stringify([...this.#set]));
  }

  delete(examined) {
    this.#set.delete(examined);
    localStorage.setItem(`breadthFirstSearch/${this.#key}`, JSON.stringify([...this.#set]));
  }
}

export { SetWithLocalStorage };
