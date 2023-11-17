import { instanceOf } from "../jsutils/instanceOf";

interface Location {
    line: number;
    column: number;
}

export class Source {
    body: string;
    name: string;
    locationOffset: Location;

    constructor(body: string, name = "GraphQL request", locationOffset: { line: 1; column: 1 }) {
        this.body = body;
        this.name = name;
        this.locationOffset = locationOffset;
    }
}

export function isSource(source: unknown): source is Source {
    return instanceOf(source, Source);
}
