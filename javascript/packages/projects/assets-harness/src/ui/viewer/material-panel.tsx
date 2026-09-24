import type { MaterialPatch, SceneInfo, SceneMaterial } from "./scene.js";

interface Props {
  info: SceneInfo;
  onSelect(uuid: string | null): void;
  onPatch(key: string, patch: MaterialPatch): void;
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
}): React.JSX.Element {
  return (
    <label className="slot__slider" title={`${label}: ${value.toFixed(2)}`}>
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
      />
    </label>
  );
}

function Material({
  material,
  selected,
  onSelect,
  onPatch,
}: {
  material: SceneMaterial;
  selected: string | null;
  onSelect(uuid: string | null): void;
  onPatch(patch: MaterialPatch): void;
}): React.JSX.Element {
  const onSelectedMesh = material.meshes.some((mesh) => mesh.uuid === selected);
  return (
    <div className={onSelectedMesh ? "slot slot--selected" : "slot"}>
      <div className="slot__head">
        <input
          type="color"
          value={material.color}
          title={material.textured ? "Base colour, a tint over the texture" : "Base colour"}
          onChange={(event) => {
            onPatch({ color: event.target.value });
          }}
        />
        <span className="slot__name" title={material.name}>
          {material.name}
        </span>
        {material.textured ? <span className="slot__tag" title="The base colour comes from a texture">tex</span> : null}
        <label className="slot__check" title="Wireframe">
          <input
            type="checkbox"
            checked={material.wireframe}
            onChange={(event) => {
              onPatch({ wireframe: event.target.checked });
            }}
          />
          wire
        </label>
      </div>
      <Slider
        label="metal"
        value={material.metalness}
        onChange={(value) => {
          onPatch({ metalness: value });
        }}
      />
      <Slider
        label="rough"
        value={material.roughness}
        onChange={(value) => {
          onPatch({ roughness: value });
        }}
      />
      <Slider
        label="alpha"
        value={material.opacity}
        onChange={(value) => {
          onPatch({ opacity: value });
        }}
      />
      <div className="slot__meshes">
        {material.meshes.map((mesh) => {
          const on = mesh.uuid === selected;
          return (
            <button
              key={mesh.uuid}
              type="button"
              className={on ? "slot__mesh slot__mesh--on" : "slot__mesh"}
              title={`Select ${mesh.name} in the viewer`}
              onClick={() => {
                onSelect(on ? null : mesh.uuid);
              }}
            >
              {mesh.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Every material of the scene once, whatever number of meshes carries it, with
 * the meshes it sits on underneath. Edits go to the viewer's copy only, and
 * they reach every mesh the material is on. Pressing a mesh name selects it in
 * the viewer.
 */
function MaterialPanel({ info, onSelect, onPatch }: Props): React.JSX.Element {
  const count = info.materials.length;
  return (
    <aside className="materials">
      <div className="materials__title">
        <span>Materials</span>
        <small>
          {count === 0 ? "none" : `${count} in the scene`} · try-outs only, Reset restores
        </small>
      </div>
      {count === 0 ? <p className="materials__empty">No materials.</p> : null}
      {info.materials.map((material) => {
        return (
          <Material
            key={material.key}
            material={material}
            selected={info.selected}
            onSelect={onSelect}
            onPatch={(patch) => {
              onPatch(material.key, patch);
            }}
          />
        );
      })}
    </aside>
  );
}

export { MaterialPanel };
