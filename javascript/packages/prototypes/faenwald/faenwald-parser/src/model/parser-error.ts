export class FaenwaldParserError extends Error {
  constructor(message: string) {
    super(`Faenwald-Parser -- ${message}`);
  }
}

export class FaenwaldFetchError extends FaenwaldParserError {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(`fetch: ${message}`);
    this.status = status;
  }
}
