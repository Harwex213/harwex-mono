import { type ServiceA } from "./ServiceA";

class ServiceADecoratorB {
  constructor(private wrapped: ServiceA) {
  }

  public doWork(a: number, b: number) {
    return `${this.wrapped.doWork(a, b)} + DecoratorB`;
  }
}

export { ServiceADecoratorB };
