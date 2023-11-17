type TupleToObject<T extends readonly (string | symbol | number)[]> = {
    [Key in T[number]]: Key;
};

const tuple = ["tesla", "model 3", "model X", "model Y"] as const;

type Ttuple = TupleToObject<typeof tuple>;
