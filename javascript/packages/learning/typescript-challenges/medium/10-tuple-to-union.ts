type TupleToUnion<T extends readonly any[]> = T[number];

type TCase = TupleToUnion<[123, "456", true]>;
