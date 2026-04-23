import "./index.css";

const ROOT = document.getElementById("root")!;

const center = (canvasWidth: number, canvasHeight: number, width: number, height: number) => {
  return [(canvasWidth - width) / 2, (canvasHeight - height) / 2];
}

const main = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 500;
  canvas.height = 500;
  canvas.style.border = "1px solid black";

  ROOT.append(canvas);

  const ctx = canvas.getContext("2d")!;

  const secondCanvas = document.createElement("canvas");
  secondCanvas.width = 20;
  secondCanvas.height = 20;
  const secondCtx = secondCanvas.getContext("2d")!;
  secondCtx.fillStyle = "red";
  secondCtx.fillRect(0, 0, 20, 20);

  const [dx, dy] = center(canvas.width, canvas.height, 20, 20);

  ctx.drawImage(secondCanvas, dx, dy);

  const imageData = ctx.getImageData(dx, dy, 20, 20);

  /**
   * Here I locally have `rgba-unorm8` settled in pixel format. As MDN says, there also could be settled `rgba-float16`.
   * What is the difference?
   *
   * What is the SDR (Standard-dynamic-range)?
   */
  console.log(imageData);

  /**
   * Save State
   * - https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Using_images
   * - https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Pixel_manipulation_with_canvas
   * - https://developer.mozilla.org/en-US/docs/Web/API/ImageData/data
   * - https://developer.mozilla.org/en-US/docs/Web/API/ImageData
   * - https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/createImageData
   * - https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData
   * - https://developer.mozilla.org/en-US/docs/Web/API/ImageData/ImageData
   */
};

main();
