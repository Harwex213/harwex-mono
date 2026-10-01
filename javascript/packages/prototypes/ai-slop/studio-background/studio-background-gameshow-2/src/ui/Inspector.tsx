import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState } from "react";
import * as THREE from "three";
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
    if (Number.isFinite(parsed)) {
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
              object.visible = event.target.checked;
              bump();
            }}
          />
          <span className={styles.objectName}>{object.name}</span>
        </div>
        <div className={styles.component}>
          <div className={styles.componentTitle}>Transform</div>
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
            <div className={styles.emptyHint}>{object.children.length} child objects</div>
          </div>
        )}
      </div>
    </section>
  );
}

export { Inspector };
