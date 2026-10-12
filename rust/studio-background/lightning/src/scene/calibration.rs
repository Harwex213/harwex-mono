// Where things sit in the art-deco studio plate (studio-render/assets/plate.png, 2000x1131).
// All values are image UV: x and y in 0..1, y grows downward.
// Measured on the pixels: the video wall is a dark panel inside two gold lines.
// The outer line is the frame; the inner hairline is the bezel of the glass.

use crate::scene::homography::Vec2;

pub const IMAGE_WIDTH: f64 = 2000.0;
pub const IMAGE_HEIGHT: f64 = 1131.0;

const fn px(x: f64, y: f64) -> Vec2 {
    [x / IMAGE_WIDTH, y / IMAGE_HEIGHT]
}

// Corners of the glass inside the inner hairline: top-left, top-right, bottom-right, bottom-left.
// The hairline centres are at x 505.5 / 1492.5 and y 237.5 / 740.5.
pub const SCREEN_CORNERS: [Vec2; 4] = [px(507.5, 239.5), px(1491.0, 239.5), px(1491.0, 739.0), px(507.5, 739.0)];

pub const SCREEN_PIXEL_WIDTH: f64 = 1491.0 - 507.5;
pub const SCREEN_PIXEL_HEIGHT: f64 = 739.0 - 239.5;

// The floor mirrors the TV wall about the line where that wall meets the floor. The plinth steps
// stand in front of the wall and hide that line; it sits above their foot at y 803.
pub const MIRROR_Y: f64 = 778.0 / IMAGE_HEIGHT;
// First row of visible floor in front of the plinth.
pub const FLOOR_Y: f64 = 806.0 / IMAGE_HEIGHT;

// Vanishing point of the one-point perspective, where the two gold ceiling coves meet.
pub const FLOOR_VANISH: Vec2 = px(999.0, 532.0);

// Eye-level line of the perspective; lays haze onto the floor plane.
pub const HORIZON_Y: f64 = 532.0 / IMAGE_HEIGHT;

// Fluted gold-and-black columns, left to right. The shaft is the fluted part between the capital
// and the base, where the arcs crawl; the column box also covers the capital and the base rings,
// which catch the light. base_y is the foot of the column, where the floor mirrors it.
#[derive(Clone, Copy, Debug)]
pub struct Pillar {
    pub shaft: [f64; 4],
    pub column: [f64; 4],
    pub base_y: f64,
}

#[allow(clippy::too_many_arguments)]
const fn pillar(sx0: f64, sy0: f64, sx1: f64, sy1: f64, cx0: f64, cy0: f64, cx1: f64, cy1: f64, base_y: f64) -> Pillar {
    Pillar {
        shaft: [sx0 / IMAGE_WIDTH, sy0 / IMAGE_HEIGHT, sx1 / IMAGE_WIDTH, sy1 / IMAGE_HEIGHT],
        column: [cx0 / IMAGE_WIDTH, cy0 / IMAGE_HEIGHT, cx1 / IMAGE_WIDTH, cy1 / IMAGE_HEIGHT],
        base_y: base_y / IMAGE_HEIGHT,
    }
}

pub const PILLARS: [Pillar; 4] = [
    pillar(8.0, 80.0, 124.0, 800.0, 0.0, 0.0, 132.0, 945.0, 945.0),
    pillar(332.0, 205.0, 400.0, 715.0, 322.0, 130.0, 415.0, 840.0, 840.0),
    pillar(1597.0, 205.0, 1668.0, 715.0, 1585.0, 130.0, 1676.0, 840.0, 840.0),
    pillar(1874.0, 80.0, 1994.0, 800.0, 1862.0, 0.0, 2000.0, 945.0, 945.0),
];

// Recessed ceiling downlights, measured as the centroid of their white-hot pixels.
pub const DOWNLIGHTS: [Vec2; 4] = [px(454.3, 45.7), px(556.1, 137.2), px(1441.4, 137.4), px(1542.2, 45.7)];

// The ceiling cove LED strips (the gold V over the room and the line above the TV) sit inside
// these boxes (x0, y0, x1, y1). Only lit pixels inside them count as LEDs: bright gold
// elsewhere is a reflection, not a light.
pub const LED_ZONES: [[f64; 4]; 2] = [
    [470.0 / IMAGE_WIDTH, 0.0, 1530.0 / IMAGE_WIDTH, 160.0 / IMAGE_HEIGHT],
    [520.0 / IMAGE_WIDTH, 219.0 / IMAGE_HEIGHT, 1480.0 / IMAGE_WIDTH, 234.0 / IMAGE_HEIGHT],
];

// LED line of the TV frame: the outer gold line, centre and half size in plate pixels.
// The inner hairline of the bezel runs 8 px inside it.
pub struct FrameLed {
    pub centre: Vec2,
    pub half_size: Vec2,
    pub hairline_inset: f64,
}

pub const FRAME_LED: FrameLed = FrameLed { centre: [999.0, 488.5], half_size: [502.0, 259.5], hairline_inset: 8.0 };
