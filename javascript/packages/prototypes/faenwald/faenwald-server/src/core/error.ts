type RpcErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

class RpcError extends Error {
  code: string;
  statusCode: number;
  details?: unknown;

  constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON(): RpcErrorBody {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined && { details: this.details }),
    };
  }
}

export { RpcError };
export type { RpcErrorBody };
