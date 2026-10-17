// A save refused because the file changed on disk since the document read it (CONF-1).
// The tRPC client carries the server's error code in `data.code`.
const isConflictError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return false;
  }

  const data = (error as { data?: { code?: unknown } | null }).data;

  return data?.code === "CONFLICT";
};

export { isConflictError };
