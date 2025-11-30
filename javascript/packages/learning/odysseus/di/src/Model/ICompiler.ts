import { ContainerBuilder, type ICompilerPass } from "../internal";

interface ICompiler {
    addPass(pass: ICompilerPass): this;

    addPassages(...passages: ICompilerPass[]): this;

    compile(containerBuilder: ContainerBuilder): Promise<void>;
}

export { type ICompiler };
