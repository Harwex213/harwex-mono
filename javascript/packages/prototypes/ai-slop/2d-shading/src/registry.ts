import { mountLightMap } from "./demos/light-map";
import { mountProjectedShadows } from "./demos/projected-shadows";
import { mountShadowCasting } from "./demos/shadow-casting";
import { mountScreenSpace } from "./demos/screen-space";
import { mountShadowMap1D } from "./demos/shadow-map-1d";
import type { Demo } from "./demos/types";

// The six techniques from the survey, in the order they were listed: cost grows
// down the list. Only the ones with a `mount` are implemented; the rest keep their
// slot so the nav stays the table of contents of the survey.
const DEMOS: Demo[] = [
  {
    id: "sprite-shadows",
    title: "1. Спрайтовые тени",
    summary:
      "Спрайт-эллипс или скошенный силуэт под объектом, blend MULTIPLY, отдельный слой ниже сущностей. Нулевая стоимость, один батч, но тень не знает про геометрию и не обрезается стенами.",
    mount: null,
  },
  {
    id: "projected-polygons",
    title: "2. Проективные полигоны",
    summary:
      "Силуэт окклюдера, сдвинутый вдоль направления света, — полигон тени. Копится в offscreen-буфере и композитится одним MULTIPLY.",
    mount: mountProjectedShadows,
  },
  {
    id: "shadow-casting",
    title: "3. Shadow casting (CPU)",
    summary:
      "Полигон видимости точечного источника: лучи в вершины окклюдеров ±ε, сортировка по углу, fan. Для сетки — recursive shadowcasting по октантам, годится под FOV и туман войны. Оба алгоритма кормят один лайтмап.",
    mount: mountShadowCasting,
  },
  {
    id: "shadow-map-1d",
    title: "4. 1D shadow map (GPU)",
    summary:
      "Три пасса на источник: силуэты окклюдеров в квадратный буфер, марш лучей → карта расстояний N×1 (угол по X, дистанция в R), шейдер света сэмплит по atan2 и сравнивает. Мягкость — PCF по соседним углам. Стоимость не зависит от числа окклюдеров.",
    mount: mountShadowMap1D,
  },
  {
    id: "light-map",
    title: "5. Light map композит",
    summary:
      "Общая схема для 2–4: ambient-заливка, аддитивные источники и вычитание теней в отдельный RenderTexture, финальный fullscreen quad умножает сцену на лайтмап. Буфер держат в 1/2–1/4 разрешения, сумма света тонмапится, а не клипается.",
    mount: mountLightMap,
  },
  {
    id: "screen-space",
    title: "6. Screen-space хаки",
    summary:
      "Тень без геометрии: размытая маска силуэтов, сдвинутая по солнцу, — прижатая тень; марш по height-map в шейдере — рельефные тени, где земля и стены лежат в одном буфере высот. Стоимость — выборки на пиксель, но из-за края буфера тень не придёт.",
    mount: mountScreenSpace,
  },
];

function findDemo(id: string): Demo | undefined {
  return DEMOS.find((demo) => demo.id === id);
}

export { DEMOS, findDemo };
