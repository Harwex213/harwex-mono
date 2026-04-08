export class FaenwaldCoreError extends Error {
  constructor(message: string) {
    super(`Faenwald-Core -- ${message}`);
  }
}
