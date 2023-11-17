import { type ContainerBuilder, type ICompiler, type ICompilerPass } from "./internal";

class Compiler implements ICompiler {
    private passes: ICompilerPass[] = [];

    public addPass(pass: ICompilerPass): this {
        this.passes.push(pass);

        return this;
    }

    public addPassages(...passages: ICompilerPass[]): this {
        this.passes.push(...passages);

        return this;
    }

    public async compile(containerBuilder: ContainerBuilder) {
        for (const pass of this.passes) {
            await pass.process(containerBuilder);
        }
    }
}

export { Compiler };
