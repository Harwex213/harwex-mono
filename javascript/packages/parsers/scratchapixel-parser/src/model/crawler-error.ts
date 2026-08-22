/** Base error for every failure raised by this package. */
class ScratchapixelParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScratchapixelParserError";
  }
}

/** A request failed outright, or came back with a status we cannot use. */
class ScratchapixelFetchError extends ScratchapixelParserError {
  readonly url: string;
  readonly status: number | undefined;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = "ScratchapixelFetchError";
    this.url = url;
    this.status = status;
  }
}

export { ScratchapixelParserError, ScratchapixelFetchError };
