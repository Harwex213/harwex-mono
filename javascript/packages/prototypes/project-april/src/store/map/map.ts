import { TAsset, TTileClimate, TTileType } from "../map/constants.ts";

type TMapGridTile = {
    row: number;
    col: number;
    type: TTileType;
    climate: TTileClimate;
    regionId: null;
    asset: TAsset;
};

type TMapGridRow = TMapGridTile[];

type TMapGrid = TMapGridRow[];

type TMapRegion = {
    id: string;
    tiles: number[];
    border: number[];
    color: string;
};

type TWithMapState = {
    map: {
        height: number;
        width: number;
        grid: TMapGrid;
        regions: Record<string, TMapRegion>;
    };
};

type TWithMapEditorState = {
    mapEditor: {
        nextRegionId: number;
    };
};

const mapInitialState: TWithMapState["map"] = {
    width: 0,
    height: 0,
    grid: [],
    regions: {},
};

export { mapInitialState };
export type { TMapGridTile, TMapGridRow, TMapGrid, TWithMapState, TWithMapEditorState };
