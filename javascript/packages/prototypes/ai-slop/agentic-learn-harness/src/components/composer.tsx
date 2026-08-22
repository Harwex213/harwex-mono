import { useCallback, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent } from "react";
import type { PromptImage } from "../../shared/types.ts";
import { imageUrl, uploadImage } from "../api/client.ts";
import { useHarness } from "../state/harness.tsx";

type ComposerProps = {
  nodeId: string;
  prompt: string;
  images: PromptImage[];
  placeholder: string;
  submitLabel: string;
  autoFocus: boolean;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Composer({
  nodeId,
  prompt,
  images,
  placeholder,
  submitLabel,
  autoFocus,
}: ComposerProps) {
  const { setPrompt, setImages, submit, notify } = useHarness();
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const addFiles = useCallback(
    async (files: File[]) => {
      const pictures = files.filter((file) => {
        return file.type.startsWith("image/");
      });
      if (pictures.length === 0) {
        return;
      }
      setUploading((count) => {
        return count + pictures.length;
      });
      const uploaded: PromptImage[] = [];
      for (const file of pictures) {
        try {
          uploaded.push(await uploadImage(file));
        } catch (error) {
          notify(error instanceof Error ? error.message : String(error));
        }
      }
      setUploading((count) => {
        return count - pictures.length;
      });
      if (uploaded.length === 0) {
        return;
      }
      const merged = [...images];
      for (const image of uploaded) {
        if (!merged.some((existing) => {
          return existing.id === image.id;
        })) {
          merged.push(image);
        }
      }
      setImages(nodeId, merged);
    },
    [images, nodeId, notify, setImages],
  );

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    void addFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit(nodeId);
    }
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    void addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const removeImage = (id: string) => {
    setImages(
      nodeId,
      images.filter((image) => {
        return image.id !== id;
      }),
    );
  };

  return (
    <div
      className={dragging ? "composer composer--dragging" : "composer"}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      <textarea
        className="composer__text"
        value={prompt}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={4}
        onChange={(event) => {
          setPrompt(nodeId, event.target.value);
        }}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
      />
      {images.length > 0 ? (
        <ul className="composer__images">
          {images.map((image) => {
            return (
              <li className="composer__image" key={image.id}>
                <img src={imageUrl(image.id)} alt={image.name} />
                <span className="composer__image-meta">{formatBytes(image.bytes)}</span>
                <button
                  className="composer__image-remove"
                  type="button"
                  title={`Remove ${image.name}`}
                  onClick={() => {
                    removeImage(image.id);
                  }}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="composer__actions">
        <input
          ref={fileInput}
          className="composer__file"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={onPick}
        />
        <button
          className="button button--ghost"
          type="button"
          onClick={() => {
            fileInput.current?.click();
          }}
        >
          Add image
        </button>
        <span className="composer__hint">
          {uploading > 0 ? `Uploading ${uploading}…` : "Paste, drop, or pick images"}
        </span>
        <button
          className="button button--primary"
          type="button"
          onClick={() => {
            submit(nodeId);
          }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export { Composer, formatBytes };
