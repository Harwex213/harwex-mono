import { type ICommand, type IHandler } from "./Handler";

interface IHandlerMap {
    [type: string]: IHandler;
}

class Bus implements IHandler {
    private handlers: IHandlerMap = {};

    public addHandler(handler: IHandler, type: string) {
        this.handlers[type] = handler;
    }

    public getHandlers(): IHandlerMap {
        return this.handlers;
    }

    public handle(command: ICommand): any {
        return this.handlers[command.type]?.handle(command);
    }
}

export type { IHandlerMap };

export { Bus };
