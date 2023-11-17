import { button, checkbox, div, from, h1, img, label } from "@hw/html-lib";
import { effect, signal } from "@hw/signals";
import { clsx } from "@hw/utils";
import { generateHEX } from "@hw/utils";
import { createMap } from "../../map/map.js";
import { createRenderApp } from "../../render-app/create-render-app.js";
import { MapRenderer } from "../../render-app/map-renderer.js";
import classes from "./map-editor.module.css";

const MAP_EDITOR_STATE = {
    EDIT_TILES: "EditTiles",
    EDIT_REGIONS: "EditRegions",
};

const mapService = ({ map, mapEditorState }) => {
    let disposed = false;
    let disposeRenderApp;
    const canvas = signal(null);

    const startRender = async () => {
        // TODO: this two actions maybe could easily be merged into one & thus incapsulate app, viewport and sheet
        const { app, sheet, viewport } = await createRenderApp();
        canvas.value = app.canvas;
        const mapRenderer = new MapRenderer(map, sheet, viewport);

        const effectDispose = effect(() => {
            const currentMapEditorState = mapEditorState.value;

            mapRenderer.clearChildren();

            if (currentMapEditorState === MAP_EDITOR_STATE.EDIT_TILES) {
                mapRenderer.renderMapTiles();
                mapRenderer.renderMapRegions();
            } else {
                mapRenderer.renderMapTilesByRegions();
            }
        });

        disposeRenderApp = () => {
            app.destroy();
            effectDispose();
            canvas.value = null;
        };
    };

    const dispose = () => {
        disposed = true;
        if (disposeRenderApp) {
            disposeRenderApp();
        }
    };

    startRender();

    return { dispose, canvas };
};

const mapUi = (ctx) => {
    const canvasContainer = div({ className: classes.mapContainer });
    const service = mapService(ctx);

    canvasContainer.assocEffect(() => {
        const canvas = service.canvas.value;
        if (canvas) {
            canvasContainer.child(from(canvas));
        }
    });
    canvasContainer.addFinalizer(service.dispose);

    return canvasContainer;
};

const editorPanelCheckboxUi = ({ mapEditorState }) => {
    const editorPanelCheckbox = checkbox({ id: "mapEditorCheckbox" });

    editorPanelCheckbox.assocEffect(() => {
        const currentMapEditorState = mapEditorState.value;

        editorPanelCheckbox.props({ checked: currentMapEditorState === MAP_EDITOR_STATE.EDIT_REGIONS });
    });

    return editorPanelCheckbox;
};

const TILE_PATHS = ["/Sprite-grass.png", "/Sprite-medium.png", "/Sprite-water.png", "/Sprite-fortress.png"];

const tileUi = ({ selectedTile }, path) => {
    const handleClick = () => {
        selectedTile.value = path;
    };

    const image = img({ className: classes.mapEditorTile, src: path, onClick: handleClick });

    image.assocEffect(() => {
        const isSelected = selectedTile.value === path;
        image.props({ className: clsx(isSelected && classes.mapEditorTileSelected, classes.mapEditorTile) });
    });

    return image;
};

const tilesEditorUi = () => {
    const selectedTile = signal(TILE_PATHS[0]);

    const ctx = { selectedTile };

    const images = TILE_PATHS.map((path) => tileUi(ctx, path));

    return div({ className: classes.mapEditorTileGrid }).children(images);
};

const regionUi = ({ map, regionId, selectedRegion, selectRegion, removeRegion }) => {
    const region = map.region(regionId);

    return div({ onClick: selectRegion }).children([
        div().content(`Region ${regionId}`),
        div().content(region.color),
        button({ onClick: () => removeRegion(regionId) }).content("Remove"),
    ]);
};

const regionsEditorUi = ({ map }) => {
    const createdRegions = signal(map.regionIds);
    const selectedRegion = signal(-1);
    const addRegion = () => {
        const newRegionId = map.createRegion(generateHEX());
        createdRegions.value = [...createdRegions.peek(), newRegionId];
    };
    const removeRegion = (id) => {
        createdRegions.value = createdRegions.peek().filter((regionId) => regionId !== id);
        map.removeRegion(id);
    };
    const selectRegion = (id) => {
        selectedRegion.value = id;
    };

    const regionsEditor = div();

    regionsEditor.assocEffect(() => {
        const regionsUi = createdRegions.value.map((regionId) =>
            regionUi({
                map,
                regionId,
                selectedRegion,
                selectRegion,
                removeRegion,
            }),
        );

        regionsUi.push(button({ onClick: addRegion }).content("Add region"));

        regionsEditor.children(regionsUi);
    });

    return regionsEditor;
};

const editorPanelUi = (ctx) => {
    const { mapEditorState } = ctx;

    const handleClick = (e) => {
        e.preventDefault();
        mapEditorState.value =
            mapEditorState.peek() === MAP_EDITOR_STATE.EDIT_TILES
                ? MAP_EDITOR_STATE.EDIT_REGIONS
                : MAP_EDITOR_STATE.EDIT_TILES;
    };

    const actualEditorContainer = div();

    actualEditorContainer.assocEffect(() => {
        if (mapEditorState.value === MAP_EDITOR_STATE.EDIT_TILES) {
            actualEditorContainer.child(tilesEditorUi(ctx));
        } else {
            actualEditorContainer.child(regionsEditorUi(ctx));
        }
    });

    return div({ className: classes.mapEditorPanel }).children([
        h1({ className: classes.mapEditorTitle }).content("Map Editor"),
        button({ className: classes.mapEditorCheckbox, onClick: handleClick }).children([
            editorPanelCheckboxUi(ctx),
            label({ for: "mapEditorCheckbox" }).content("Regions Editor"),
        ]),
        actualEditorContainer,
    ]);
};

const mapEditorUi = () => {
    const mapEditorState = signal(MAP_EDITOR_STATE.EDIT_TILES);
    const map = createMap(60, 60);

    const context = { map, mapEditorState };

    return div({ className: classes.mapEditorContainer }).children([mapUi(context), editorPanelUi(context)]);
};

export { mapEditorUi };
