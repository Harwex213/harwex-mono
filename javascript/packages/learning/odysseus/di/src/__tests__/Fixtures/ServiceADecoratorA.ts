import { type ServiceA } from "./ServiceA";

class ServiceADecoratorA {
  constructor(private wrapped: ServiceA) {
  }

  public doWork(a: number, b: number) {
    return `${this.wrapped.doWork(a, b)} + DecoratorA`;
  }
}

export { ServiceADecoratorA };
