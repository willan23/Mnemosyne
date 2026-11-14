/** Private, immutable raw source references shared by publication and semantic preparation. */
export interface PublicationSourceSnapshot<T> {
  readonly key: string;
  readonly priority: number;
  readonly ordinal: number;
  readonly count: number;
  active(): boolean;
  get(id: string): T | null | undefined;
  orderedRows(): IterableIterator<{ id: string; value: T | null }>;
}

export interface PublicationOrderVersion {
  readonly id: string;
  readonly size: number;
  readonly priority: number;
  readonly left: PublicationOrderVersion | null;
  readonly right: PublicationOrderVersion | null;
}

export function* publicationOrderIds(root: PublicationOrderVersion | null): IterableIterator<string> {
  const stack: PublicationOrderVersion[] = []; let node = root;
  while (node || stack.length) {
    while (node) { stack.push(node); node = node.left; }
    node = stack.pop()!; yield node.id; node = node.right;
  }
}
