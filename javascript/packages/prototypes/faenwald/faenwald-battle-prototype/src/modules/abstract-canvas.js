const exampleConfig = {
  onPointerUp: (state) => {
    // TODO: exampled code
  },

  onPointerMove: (state) => {

  },

  // User specified scene render
  render: (canvasState) => {
    const {
      ctx,
      hovered,
      camera,
    } = canvasState;

    // TODO: exampled code

    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const { x, y } = offsetToPixel(col, row, HEX_SIZE);
        renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, {
          fill: { style: fillByTerrain[map.cells[row][col]] ?? fillByTerrain[DEFAULT_TERRAIN_ID] },
          stroke: { style: gridColor, width: GRID_STROKE_PX / camera.scale },
        });
      }
    }

    if (hovered) {
      const { x, y } = offsetToPixel(hovered.col, hovered.row, HEX_SIZE);
      renderPointTopHexagon(ctx, x, y, HEX_HEIGHT, {
        stroke: { style: hoverColor, width: HOVER_STROKE_PX / camera.scale },
      });
    }
  }
};
