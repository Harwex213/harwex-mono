export function isPromise(value: any): value is Promise<unknown> {
    return typeof value?.then === "function";
}
