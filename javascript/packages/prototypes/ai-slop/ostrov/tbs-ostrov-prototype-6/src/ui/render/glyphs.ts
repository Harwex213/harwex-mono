import type { TGlyph } from "../../domain/battle/archetypes";

/**
 * Every glyph is drawn upright inside a box of `size` half-extent, centred on
 * the current origin. No rotation: a readable badge beats a correct pose.
 */
const drawGlyph = (ctx: CanvasRenderingContext2D, glyph: TGlyph, size: number, color: string): void => {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.4, size * 0.22);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (glyph === "sword") {
    // Blade with a pointed tip and a pommel, so it never reads as a plus sign.
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.1);
    ctx.lineTo(size * 0.3, -size * 0.6);
    ctx.lineTo(size * 0.3, size * 0.2);
    ctx.lineTo(-size * 0.3, size * 0.2);
    ctx.lineTo(-size * 0.3, -size * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = Math.max(1.4, size * 0.24);
    ctx.beginPath();
    ctx.moveTo(-size * 0.75, size * 0.35);
    ctx.lineTo(size * 0.75, size * 0.35);
    ctx.moveTo(0, size * 0.35);
    ctx.lineTo(0, size * 1.05);
    ctx.stroke();

    return;
  }

  if (glyph === "spear") {
    ctx.beginPath();
    ctx.moveTo(0, size);
    ctx.lineTo(0, -size * 0.35);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, -size * 1.1);
    ctx.lineTo(size * 0.42, -size * 0.25);
    ctx.lineTo(-size * 0.42, -size * 0.25);
    ctx.closePath();
    ctx.fill();

    return;
  }

  if (glyph === "bow") {
    ctx.beginPath();
    ctx.arc(-size * 0.15, 0, size * 0.9, -Math.PI * 0.42, Math.PI * 0.42);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-size * 0.15 + size * 0.9 * Math.cos(-Math.PI * 0.42), size * 0.9 * Math.sin(-Math.PI * 0.42));
    ctx.lineTo(-size * 0.15 + size * 0.9 * Math.cos(Math.PI * 0.42), size * 0.9 * Math.sin(Math.PI * 0.42));
    ctx.stroke();

    // The nocked arrow is what separates the bow from a bare letter D.
    ctx.lineWidth = Math.max(1, size * 0.16);
    ctx.beginPath();
    ctx.moveTo(-size * 0.95, 0);
    ctx.lineTo(size * 0.55, 0);
    ctx.stroke();

    return;
  }

  if (glyph === "shield") {
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.85, -size * 0.55);
    ctx.lineTo(size * 0.85, size * 0.15);
    ctx.lineTo(0, size);
    ctx.lineTo(-size * 0.85, size * 0.15);
    ctx.lineTo(-size * 0.85, -size * 0.55);
    ctx.closePath();
    ctx.stroke();

    return;
  }

  if (glyph === "cross") {
    // A filled medical cross: solid where the sword is a thin outline.
    const arm = size * 0.36;
    ctx.beginPath();
    ctx.rect(-arm, -size, arm * 2, size * 2);
    ctx.rect(-size, -arm, size * 2, arm * 2);
    ctx.fill();

    return;
  }

  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, 0);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * 0.7, 0);
  ctx.closePath();
  ctx.stroke();
};

export { drawGlyph };
