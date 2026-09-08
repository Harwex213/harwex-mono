import type { MaterialSlot, SceneInfo, SlotPatch } from "./scene.js";

interface Props {
  info: SceneInfo;
  onSelect(uuid: string | null): void;
  onPatch(key: string, patch: SlotPatch): void;
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

function Slot({ slot, onPatch }: { slot: MaterialSlot; onPatch(patch: SlotPatch): void }): React.JSX.Element {
  return (
    <div className="slot">
      <div className="slot__head">
        <input
          type="color"
          value={slot.color}
          title="Base colour"
          onChange={(event) => {
            onPatch({ color: event.target.value });
          }}
        />
        <span className="slot__name" title={slot.materialName}>
          {slot.materialName}
        </span>
        <label className="slot__check" title="Wireframe">
          <input
            type="checkbox"
            checked={slot.wireframe}
            onChange={(event) => {
              onPatch({ wireframe: event.target.checked });
            }}
          />
          wire
        </label>
      </div>
      <Slider
        label="metal"
        value={slot.metalness}
        onChange={(value) => {
          onPatch({ metalness: value });
        }}
      />
      <Slider
        label="rough"
        value={slot.roughness}
        onChange={(value) => {
          onPatch({ roughness: value });
        }}
      />
      <Slider
        label="alpha"
        value={slot.opacity}
        onChange={(value) => {
          onPatch({ opacity: value });
        }}
      />
    </div>
  );
}

/**
 * Every mesh with its material slots, as Blender has them. Edits go to the
 * viewer's copy only. Pressing a mesh name selects it in the viewer.
 */
function MaterialPanel({ info, onSelect, onPatch }: Props): React.JSX.Element {
  const byMesh = new Map<string, MaterialSlot[]>();
  for (const slot of info.slots) {
    const list = byMesh.get(slot.meshUuid) ?? [];
    list.push(slot);
    byMesh.set(slot.meshUuid, list);
  }
  return (
    <aside className="materials">
      <div className="materials__title">
        <span>Material slots</span>
        <small>try-outs only, Reset restores</small>
      </div>
      {byMesh.size === 0 ? <p className="materials__empty">No meshes.</p> : null}
      {[...byMesh.entries()].map(([uuid, slots]) => {
        const selected = uuid === info.selected;
        return (
          <div key={uuid} className={selected ? "mesh mesh--selected" : "mesh"}>
            <button
              type="button"
              className="mesh__name"
              title="Select this mesh in the viewer"
              onClick={() => {
                onSelect(selected ? null : uuid);
              }}
            >
              {slots[0]?.meshName}
              <small>
                {slots.length} slot{slots.length === 1 ? "" : "s"}
              </small>
            </button>
            {slots.map((slot) => {
              return (
                <Slot
                  key={slot.key}
                  slot={slot}
                  onPatch={(patch) => {
                    onPatch(slot.key, patch);
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </aside>
  );
}

export { MaterialPanel };
