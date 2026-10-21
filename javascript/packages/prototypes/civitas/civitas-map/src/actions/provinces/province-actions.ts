import {
  createProvince,
  packOpaque,
  takenColors,
  toHex,
  type ProvinceKind,
  type Rgb,
} from "../../domain/index";
import type { TStore } from "../../store/index";
import { commitStroke } from "../map/layer-commit";

function addProvince(store: TStore): void {
  const provinces = store.provinces;
  const province = createProvince(provinces.nextId.value, takenColors(provinces.list.value));

  provinces.nextId.value += 1;
  provinces.list.value = [...provinces.list.value, province];
  provinces.activeId.value = province.id;
}

function selectProvince(store: TStore, id: number): void {
  store.provinces.activeId.value = id;
}

// Makes the province painted in `color` active. False when no province owns it.
function selectProvinceByColor(store: TStore, color: number): boolean {
  const found = store.provinces.list.value.find((province) => province.color === color);

  if (!found) {
    return false;
  }

  store.provinces.activeId.value = found.id;

  return true;
}

function renameProvince(store: TStore, id: number, name: string): void {
  store.provinces.list.value = store.provinces.list.value.map((province) => {
    if (province.id !== id) {
      return province;
    }

    return { ...province, name };
  });
}

function setProvinceKind(store: TStore, id: number, kind: ProvinceKind): void {
  store.provinces.list.value = store.provinces.list.value.map((province) => {
    if (province.id !== id) {
      return province;
    }

    return { ...province, kind };
  });
}

// Recolouring rewrites the province's existing pixels in the same step, so the
// image never holds a colour the registry does not know.
function recolorProvince(store: TStore, id: number, rgb: Rgb): boolean {
  const list = store.provinces.list.value;
  const target = list.find((province) => province.id === id);
  const color = packOpaque(rgb);

  if (!target || target.color === color) {
    return false;
  }

  if (takenColors(list).has(color)) {
    store.status.error.value = `${toHex(rgb)} is already used by another province`;

    return false;
  }

  const layer = store.map.layer.value;

  if (layer) {
    layer.beginStroke();
    layer.replaceColor(target.color, color);
    commitStroke(store);
  }

  store.provinces.list.value = store.provinces.list.value.map((province) => {
    if (province.id !== id) {
      return province;
    }

    return { ...province, color, hex: toHex(rgb) };
  });

  return true;
}

function deleteProvince(store: TStore, id: number): void {
  const target = store.provinces.list.value.find((province) => province.id === id);

  if (!target) {
    return;
  }

  const layer = store.map.layer.value;

  if (layer) {
    layer.beginStroke();
    layer.replaceColor(target.color, 0);
    commitStroke(store);
  }

  store.provinces.list.value = store.provinces.list.value.filter((province) => province.id !== id);

  if (store.provinces.activeId.value === id) {
    store.provinces.activeId.value = store.provinces.list.value.at(-1)?.id ?? null;
  }
}

export {
  addProvince,
  deleteProvince,
  recolorProvince,
  renameProvince,
  selectProvince,
  selectProvinceByColor,
  setProvinceKind,
};
