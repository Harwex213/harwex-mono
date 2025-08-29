class HierarchyNode {
  static #internalId = 0;

  #children = null;

  constructor(data) {
    this.id = HierarchyNode.#internalId.toString();
    this.data = data;

    HierarchyNode.#internalId++;
  }

  get children() {
    if (!this.#children) {
      this.#children = [];
    }

    return this.#children;
  }

  set children(children) {
    this.#children = children;
  }

  addChild(data) {
    this.children.push(data);
  }

  child(index) {
    return this.children[index];
  }
}

export { HierarchyNode };
