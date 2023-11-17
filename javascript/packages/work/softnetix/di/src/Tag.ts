class Tag<T extends Record<string, any> = Record<string, any>> {
    constructor(
        public name: string,
        public attributes: T = {} as T,
    ) {}
}

export { Tag };
