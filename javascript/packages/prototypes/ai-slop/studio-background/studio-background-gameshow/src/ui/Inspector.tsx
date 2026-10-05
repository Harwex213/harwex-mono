import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState } from "react";
import * as THREE from "three";
import { getEngine } from "../engine/engine";
import { editableMaterials } from "../engine/sceneDocument";
import { inspectorRevision, selectedUuid } from "../state";
import styles from "./Editor.module.css";

interface InspectorProps {
  root: THREE.Object3D;
}

interface NumberFieldProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}

// Keeps its own text while focused, so typing is not overwritten by the live value.
function NumberField(props: NumberFieldProps) {
  const { label, value, onCommit } = props;
  const [text, setText] = useState(value.toFixed(2));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(value.toFixed(2));
    }
  }, [value, focused]);

  function commit(): void {
    const parsed = Number.parseFloat(text);
    // Leaving a field without typing is not an edit.
    if (Number.isFinite(parsed) && text !== value.toFixed(2)) {
      checkpoint();
      onCommit(parsed);
    }
  }

  return (
    <label className={styles.numberField}>
      <span className={styles.axisLabel}>{label}</span>
      <input
        className={styles.numberInput}
        value={text}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

interface VectorRowProps {
  title: string;
  values: [number, number, number];
  onCommit: (axis: number, value: number) => void;
}

function VectorRow(props: VectorRowProps) {
  const { title, values, onCommit } = props;
  const axes = ["X", "Y", "Z"];
  return (
    <div className={styles.vectorRow}>
      <span className={styles.rowTitle}>{title}</span>
      <div className={styles.vectorFields}>
        {values.map((value, axis) => (
          <NumberField
            key={axes[axis]}
            label={axes[axis] ?? ""}
            value={value}
            onCommit={(next) => {
              onCommit(axis, next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

interface ColorRowProps {
  title: string;
  color: THREE.Color;
}

function ColorRow(props: ColorRowProps) {
  const { title, color } = props;
  return (
    <div className={styles.vectorRow}>
      <span className={styles.rowTitle}>{title}</span>
      <input
        type="color"
        onClick={checkpoint}
        className={styles.colorInput}
        value={`#${color.getHexString()}`}
        onChange={(event) => {
          color.set(event.target.value);
          bump();
        }}
      />
    </div>
  );
}

interface ScalarRowProps {
  title: string;
  value: number;
  onCommit: (value: number) => void;
}

function ScalarRow(props: ScalarRowProps) {
  const { title, value, onCommit } = props;
  return (
    <div className={styles.vectorRow}>
      <span className={styles.rowTitle}>{title}</span>
      <div className={styles.vectorFields}>
        <NumberField
          label=""
          value={value}
          onCommit={(next) => {
            onCommit(next);
            bump();
          }}
        />
      </div>
    </div>
  );
}

// A shared material: an edit here changes every object that uses it, like a material asset in Unity.
function MaterialComponent(props: { material: THREE.MeshStandardMaterial }) {
  const { material } = props;
  return (
    <div className={styles.component}>
      <div className={styles.componentTitle}>Material · {material.name}</div>
      <ColorRow title="Color" color={material.color} />
      <ScalarRow
        title="Roughness"
        value={material.roughness}
        onCommit={(value) => {
          material.roughness = THREE.MathUtils.clamp(value, 0, 1);
        }}
      />
      <ScalarRow
        title="Metalness"
        value={material.metalness}
        onCommit={(value) => {
          material.metalness = THREE.MathUtils.clamp(value, 0, 1);
        }}
      />
      <ColorRow title="Emissive" color={material.emissive} />
      <ScalarRow
        title="Emission"
        value={material.emissiveIntensity}
        onCommit={(value) => {
          material.emissiveIntensity = Math.max(0, value);
        }}
      />
    </div>
  );
}

// Remembers the state for undo. Every edit in the inspector calls it first.
function checkpoint(): void {
  getEngine().document.checkpoint();
}

function bump(): void {
  inspectorRevision.value += 1;
}

function typeLabel(object: THREE.Object3D): string {
  if ((object as THREE.Light).isLight) {
    return object.type;
  }
  if ((object as THREE.Mesh).isMesh) {
    return "Mesh Renderer";
  }
  return "Transform Group";
}

function Inspector(props: InspectorProps) {
  useSignals();
  const { root } = props;
  // Reading the revision subscribes this component to transform edits.
  void inspectorRevision.value;
  const uuid = selectedUuid.value;
  const object = uuid ? root.getObjectByProperty("uuid", uuid) : undefined;

  if (!object) {
    return (
      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <span className={styles.panelTitle}>Inspector</span>
        </header>
        <div className={styles.emptyHint}>Select an object in the Hierarchy or click it in the Scene view.</div>
      </section>
    );
  }

  const position: [number, number, number] = [object.position.x, object.position.y, object.position.z];
  const rotation: [number, number, number] = [
    THREE.MathUtils.radToDeg(object.rotation.x),
    THREE.MathUtils.radToDeg(object.rotation.y),
    THREE.MathUtils.radToDeg(object.rotation.z),
  ];
  const scale: [number, number, number] = [object.scale.x, object.scale.y, object.scale.z];
  const light = (object as THREE.Light).isLight ? (object as THREE.Light) : null;

  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <span className={styles.panelTitle}>Inspector</span>
      </header>
      <div className={styles.panelBody}>
        <div className={styles.objectHeader}>
          <input
            type="checkbox"
            checked={object.visible}
            onChange={(event) => {
              checkpoint();
              object.visible = event.target.checked;
              bump();
            }}
          />
          <span className={styles.objectName}>{object.name}</span>
        </div>
        <div className={styles.component}>
          <div className={styles.componentTitle}>Transform</div>
          {object.userData.animated ? (
            <div className={styles.componentNote}>Driven by the animation while Play is on. Not saved.</div>
          ) : null}
          <VectorRow
            title="Position"
            values={position}
            onCommit={(axis, value) => {
              object.position.setComponent(axis, value);
              bump();
            }}
          />
          <VectorRow
            title="Rotation"
            values={rotation}
            onCommit={(axis, value) => {
              const radians = THREE.MathUtils.degToRad(value);
              if (axis === 0) {
                object.rotation.x = radians;
              } else if (axis === 1) {
                object.rotation.y = radians;
              } else {
                object.rotation.z = radians;
              }
              bump();
            }}
          />
          <VectorRow
            title="Scale"
            values={scale}
            onCommit={(axis, value) => {
              object.scale.setComponent(axis, value);
              bump();
            }}
          />
        </div>
        {light ? (
          <div className={styles.component}>
            <div className={styles.componentTitle}>{typeLabel(object)}</div>
            <div className={styles.vectorRow}>
              <span className={styles.rowTitle}>Color</span>
              <input
                type="color"
                onClick={checkpoint}
                className={styles.colorInput}
                value={`#${light.color.getHexString()}`}
                onChange={(event) => {
                  light.color.set(event.target.value);
                  bump();
                }}
              />
            </div>
            <div className={styles.vectorRow}>
              <span className={styles.rowTitle}>Intensity</span>
              <div className={styles.vectorFields}>
                <NumberField
                  label="I"
                  value={light.intensity}
                  onCommit={(value) => {
                    light.intensity = value;
                    bump();
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.component}>
            <div className={styles.componentTitle}>{typeLabel(object)}</div>
            <div className={styles.componentNote}>{object.children.length} child objects</div>
          </div>
        )}
        {editableMaterials(object).map((material) => (
          <MaterialComponent key={material.uuid} material={material} />
        ))}
      </div>
    </section>
  );
}

export { Inspector };
