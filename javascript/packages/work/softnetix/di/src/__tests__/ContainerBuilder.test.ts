import { describe, it } from "node:test";
import { ContainerBuilder, Definition, Reference, Tag } from "../internal";
import { Compiler } from "../Compiler";
import { Symbols } from "./Fixtures/Symbols";
import { Bus } from "./Fixtures/Bus";
import { Handler } from "./Fixtures/Handler";
import { ServiceA } from "./Fixtures/ServiceA";
import { BusPass } from "./Fixtures/BusPass";
import { strictEqual } from "node:assert";

describe("ContainerBuilder", () => {
    it("Should build container", async () => {
        const builder = new ContainerBuilder(new Compiler());

        builder.addDefinitions(
            new Definition().setId(Symbols.bus).setClass(Bus),

            new Definition()
                .setId(Symbols.handler)
                .setClass(Handler)
                .addArguments(new Reference(Symbols.service_a))
                .addTags(new Tag("handler", { type: "SUM" })),

            new Definition().setId(Symbols.service_a).setClass(ServiceA),
        );

        builder.getCompiler().addPass(new BusPass());

        const container = await builder.build();

        const bus = container.get<Bus>(Symbols.bus);

        const result = bus.handle({ type: "SUM", payload: { a: 1, b: 2 } });

        const handler = container.get(Symbols.handler);

        strictEqual("1 + 2", result);
        strictEqual(bus.getHandlers().SUM, handler);
    });
});
