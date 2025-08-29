export declare class HierarchyNode {
  id: string;
  data: any; // cast & validation is your responsibility
  children: HierarchyNode[];

  addChild(data: any): HierarchyNode;

  child(index: number): HierarchyNode;
}
