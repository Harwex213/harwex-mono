import { PreviewCard } from "./PreviewCard"
import styles from "./preview-card.module.css"

export const meta = { title: "Preview Card" }

export default function PreviewCardDemo() {
  return (
    <p style={{ maxWidth: 420, lineHeight: 1.7 }}>
      The kit was crafted by{" "}
      <PreviewCard.Root>
        <PreviewCard.Trigger href="#">@aria</PreviewCard.Trigger>
        <PreviewCard.Portal>
          <PreviewCard.Positioner side="bottom" align="center">
            <PreviewCard.Popup>
              <PreviewCard.Arrow />
              <div className={styles.profileHead}>
                <div className={styles.avatar}>AR</div>
                <div>
                  <div className={styles.name}>Aria Rivera</div>
                  <div className={styles.handle}>@aria</div>
                </div>
              </div>
              <p className={styles.bio}>
                Design systems engineer. Building accessible primitives and
                obsessing over focus rings.
              </p>
              <div className={styles.stats}>
                <span>
                  <strong>128</strong> repos
                </span>
                <span>
                  <strong>4.2k</strong> followers
                </span>
              </div>
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>{" "}
      over a weekend of caffeine and CSS variables.
    </p>
  )
}
