import { type ServiceA } from "./ServiceA";

interface ICommand {
    type: string;
    payload: any;
}

interface IHandler {
    handle(command: ICommand): any;
}

class Handler implements IHandler {
    constructor(private serviceA: ServiceA) {}

    public handle(command: { payload: { a: number; b: number }; type: "SUM" }) {
        return this.serviceA.doWork(command.payload.a, command.payload.b);
    }
}

export type { ICommand, IHandler };

export { Handler };
