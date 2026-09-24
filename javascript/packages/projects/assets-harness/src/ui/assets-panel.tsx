import { useSignals } from "@preact/signals-react/runtime";
import { useState } from "react";
import type { AssetFile, AssetModel, AssetTextureSet } from "../../shared/types.js";
import { assetUrl } from "../state/bridge.js";
import {
  activeTab,
  assets,
  openModel,
  project,
  rescanAssets,
  revealAsset,
  showNewTab,
  tabs,
} from "../state/store.js";

/**
 * The project's Assets directory, as its convention reads it: the models of
 * `blender/`, each with its textures and its exports, the shared material
 * sets, the reference images, and whatever does not fit. Pressing a model
 * opens it as a tab; pressing anything else shows it in Finder.
 *
 * The main process watches the directory, so what the agent writes into the
 * project shows up here while it works.
 */

function channelsOf(set: AssetTextureSet): string[] {
  return [...new Set(set.textures.map((texture) => texture.channel).filter(Boolean))];
}

function Thumbs({ set }: { set: AssetTextureSet }): React.JSX.Element {
  return (
    <div className="assets__thumbs">
      {set.textures.map((texture) => {
        return (
          <button
            key={texture.relPath}
            type="button"
            className="assets__thumb"
            title={`${texture.name}${texture.channel ? ` — ${texture.channel}` : ""}`}
            onClick={() => {
              revealAsset(texture.relPath);
            }}
          >
            <img src={assetUrl(texture.relPath, texture.modifiedAt)} alt={texture.name} loading="lazy" />
          </button>
        );
      })}
    </div>
  );
}

function FileLines({ files }: { files: AssetFile[] }): React.JSX.Element {
  return (
    <>
      {files.map((file) => {
        return (
          <button
            key={file.relPath}
            type="button"
            className="assets__file"
            title={file.relPath}
            onClick={() => {
              revealAsset(file.relPath);
            }}
          >
            {file.relPath}
          </button>
        );
      })}
    </>
  );
}

function ModelRow({ model }: { model: AssetModel }): React.JSX.Element {
  useSignals();
  const [open, setOpen] = useState(false);
  const tab = tabs.value.find((state) => state.tab.blendPath === model.blendPath);
  const active = activeTab.value?.tab.blendPath === model.blendPath;
  const textureCount = model.textures?.textures.length ?? 0;
  return (
    <li className={active ? "assets__model assets__model--active" : "assets__model"}>
      <div className="assets__row">
        <button
          type="button"
          className="assets__twisty"
          title={open ? "Hide textures and exports" : "Show textures and exports"}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? "▾" : "▸"}
        </button>
        <button
          type="button"
          className="assets__name"
          title={`${model.relPath}\nOpen it as a tab`}
          onClick={() => {
            void openModel(model.blendPath);
          }}
        >
          {tab ? <span className={`tab__dot tab__dot--${tab.running ? "running" : tab.blender}`} /> : null}
          {model.name}
        </button>
        <span className="assets__badges">
          {textureCount > 0 ? <span title="Textures in textures/<Model>/">{textureCount} tex</span> : null}
          {model.exports.length > 0 ? <span title="Files in export/">{model.exports.length} exp</span> : null}
        </span>
      </div>
      {open ? (
        <div className="assets__detail">
          {model.textures ? (
            <>
              <span className="assets__label">
                {model.textures.relPath}/{" "}
                {channelsOf(model.textures).length > 0 ? `· ${channelsOf(model.textures).join(", ")}` : ""}
              </span>
              <Thumbs set={model.textures} />
            </>
          ) : (
            <span className="assets__label assets__label--muted">no textures/{model.name}/ yet</span>
          )}
          {model.exports.length > 0 ? <FileLines files={model.exports} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function SetRow({ set }: { set: AssetTextureSet }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const channels = channelsOf(set);
  return (
    <li className="assets__model">
      <div className="assets__row">
        <button
          type="button"
          className="assets__twisty"
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? "▾" : "▸"}
        </button>
        <button
          type="button"
          className="assets__name"
          title={`${set.relPath}\nShow it in Finder`}
          onClick={() => {
            revealAsset(set.relPath);
          }}
        >
          {set.name}
        </button>
        <span className="assets__badges">
          <span>{set.textures.length} tex</span>
        </span>
      </div>
      {open ? (
        <div className="assets__detail">
          {channels.length > 0 ? <span className="assets__label">{channels.join(", ")}</span> : null}
          <Thumbs set={set} />
          {set.others.length > 0 ? <FileLines files={set.others} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function Section({
  title,
  count,
  children,
  initiallyOpen = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  initiallyOpen?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <section className="assets__section">
      <button
        type="button"
        className="assets__heading"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{title}</span>
        <span className="assets__count">{count}</span>
      </button>
      {open ? children : null}
    </section>
  );
}

function AssetsPanel(): React.JSX.Element {
  useSignals();
  const index = assets.value;
  const current = project.value;
  return (
    <aside className="assets">
      <header className="assets__header">
        <button
          type="button"
          className="assets__title"
          title={current ? `${current.assetsPath}\nShow it in Finder` : ""}
          onClick={() => {
            revealAsset("");
          }}
        >
          Assets
        </button>
        <span className="assets__spacer" />
        <button
          type="button"
          className="button button--small"
          title="Create a model in Assets/blender/"
          onClick={() => {
            showNewTab.value = true;
          }}
        >
          + model
        </button>
        <button
          type="button"
          className="button button--small"
          title="Read the Assets directory again"
          onClick={() => {
            void rescanAssets();
          }}
        >
          ↻
        </button>
      </header>
      {!index ? (
        <p className="assets__empty">Reading the Assets directory…</p>
      ) : (
        <div className="assets__body">
          {!index.exists ? (
            <p className="assets__empty">
              No <code>Assets/</code> yet. Creating a model makes <code>Assets/blender/</code>.
            </p>
          ) : null}
          <Section title="Models" count={index.models.length}>
            {index.models.length === 0 ? (
              <p className="assets__empty">
                No <code>.blend</code> in <code>Assets/blender/</code>.
              </p>
            ) : (
              <ul className="assets__list">
                {index.models.map((model) => {
                  return <ModelRow key={model.blendPath} model={model} />;
                })}
              </ul>
            )}
          </Section>
          {index.materials.length > 0 ? (
            <Section title="Materials" count={index.materials.length}>
              <ul className="assets__list">
                {index.materials.map((set) => {
                  return <SetRow key={set.relPath} set={set} />;
                })}
              </ul>
            </Section>
          ) : null}
          {index.orphanTextures.length > 0 ? (
            <Section title="Textures without a model" count={index.orphanTextures.length} initiallyOpen={false}>
              <ul className="assets__list">
                {index.orphanTextures.map((set) => {
                  return <SetRow key={set.relPath} set={set} />;
                })}
              </ul>
            </Section>
          ) : null}
          {index.references.length > 0 ? (
            <Section
              title="References"
              count={index.references.reduce((total, group) => total + group.files.length, 0)}
              initiallyOpen={false}
            >
              <ul className="assets__list">
                {index.references.map((group) => {
                  return (
                    <li key={group.relPath} className="assets__model">
                      <div className="assets__row">
                        <button
                          type="button"
                          className="assets__name assets__name--flat"
                          onClick={() => {
                            revealAsset(group.relPath);
                          }}
                        >
                          {group.category}/
                        </button>
                        <span className="assets__badges">
                          <span>{group.files.length}</span>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ) : null}
          {index.orphanExports.length > 0 ? (
            <Section title="Exports without a model" count={index.orphanExports.length} initiallyOpen={false}>
              <div className="assets__detail">
                <FileLines files={index.orphanExports} />
              </div>
            </Section>
          ) : null}
          {index.warnings.length > 0 ? (
            <Section title="Off the convention" count={index.warnings.length} initiallyOpen={false}>
              <ul className="assets__warnings">
                {index.warnings.map((warning) => {
                  return <li key={warning}>{warning}</li>;
                })}
              </ul>
            </Section>
          ) : null}
        </div>
      )}
    </aside>
  );
}

export { AssetsPanel };
