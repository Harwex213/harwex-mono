import { type ICompilerPass } from "../../Model/ICompilerPass";
import { type TArgument } from "../../Model/TArgument";
import { type Bus } from "./Bus";
import { Symbols } from "./Symbols";
import { ContainerBuilder } from "../../ContainerBuilder";
import { Reference } from "../../Reference";
import { MethodCall } from "../../MethodCall";

class BusPass implements ICompilerPass {
    public async process(containerBuilder: ContainerBuilder) {
        const handlerIds = containerBuilder.findTaggedServicesIds("handler");

        const busDefinition = containerBuilder.findDefinition<Bus>(Symbols.bus);

        handlerIds.forEach((id) => {
            const handlerDefinition = containerBuilder.findDefinition(id);

            const tag = handlerDefinition?.getTags().find(({ name }) => name === "handler");

            const args: TArgument[] = [new Reference(id), tag?.attributes.type];

            busDefinition?.addMethodCalls(new MethodCall("addHandler", args));
        });
    }
}

export { BusPass };
