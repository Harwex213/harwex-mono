import { ContainerBuilder } from "../internal";

interface ICompilerPass {
    process(container: ContainerBuilder): Promise<void> | void;
}

export { type ICompilerPass };
