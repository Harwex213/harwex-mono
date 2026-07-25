import { NavigationMenu } from "./NavigationMenu"
import styles from "./navigation-menu.module.css"

export const meta = { title: "Navigation Menu" }

export default function NavigationMenuDemo() {
  return (
    <NavigationMenu.Root>
      <NavigationMenu.List>
        <NavigationMenu.Item>
          <NavigationMenu.Trigger>Products</NavigationMenu.Trigger>
          <NavigationMenu.Content>
            <NavigationMenu.Link href="#analytics">
              <span className={styles.linkTitle}>Analytics</span>
              <span className={styles.linkDesc}>Understand your traffic in real time.</span>
            </NavigationMenu.Link>
            <NavigationMenu.Link href="#automation">
              <span className={styles.linkTitle}>Automation</span>
              <span className={styles.linkDesc}>Ship workflows without writing code.</span>
            </NavigationMenu.Link>
            <NavigationMenu.Link href="#security">
              <span className={styles.linkTitle}>Security</span>
              <span className={styles.linkDesc}>Enterprise-grade protection by default.</span>
            </NavigationMenu.Link>
          </NavigationMenu.Content>
        </NavigationMenu.Item>

        <NavigationMenu.Item>
          <NavigationMenu.Trigger>Resources</NavigationMenu.Trigger>
          <NavigationMenu.Content>
            <NavigationMenu.Link href="#docs" active>
              <span className={styles.linkTitle}>Documentation</span>
              <span className={styles.linkDesc}>Guides, API reference, and tutorials.</span>
            </NavigationMenu.Link>
            <NavigationMenu.Link href="#blog">
              <span className={styles.linkTitle}>Blog</span>
              <span className={styles.linkDesc}>Product news and engineering posts.</span>
            </NavigationMenu.Link>
            <NavigationMenu.Link href="#community">
              <span className={styles.linkTitle}>Community</span>
              <span className={styles.linkDesc}>Join the conversation on Discord.</span>
            </NavigationMenu.Link>
          </NavigationMenu.Content>
        </NavigationMenu.Item>

        <NavigationMenu.Item>
          <NavigationMenu.Link href="#pricing" className={styles.navLink}>
            Pricing
          </NavigationMenu.Link>
        </NavigationMenu.Item>
      </NavigationMenu.List>

      <NavigationMenu.Portal>
        <NavigationMenu.Positioner>
          <NavigationMenu.Popup>
            <NavigationMenu.Arrow />
            <NavigationMenu.Viewport />
          </NavigationMenu.Popup>
        </NavigationMenu.Positioner>
      </NavigationMenu.Portal>
    </NavigationMenu.Root>
  )
}
