import { useEffect, useMemo, useState } from "react"
import styles from "./App.module.css"
import { cn } from "../ui/utils"

/**
 * Each component ships a `demo.tsx` exporting:
 *   export const meta = { title: "Accordion" }
 *   export default function Demo() { ... }
 * They are auto-discovered here — no central registry to maintain.
 */
type DemoModule = {
  meta: { title: string }
  default: React.ComponentType
}

const context = import.meta.webpackContext("../ui", {
  recursive: true,
  regExp: /demo\.tsx$/,
})

const demos = context
  .keys()
  .map((key) => context(key) as DemoModule)
  .map((m) => ({ title: m.meta.title, Component: m.default }))
  .sort((a, b) => a.title.localeCompare(b.title))

function useTheme() {
  const [dark, setDark] = useState(
    () =>
      window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  )
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])
  return { dark, toggle: () => setDark((d) => !d) }
}

export function App() {
  const [active, setActive] = useState(0)
  const [query, setQuery] = useState("")
  const { dark, toggle } = useTheme()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return demos
      .map((d, i) => ({ ...d, i }))
      .filter((d) => !q || d.title.toLowerCase().includes(q))
  }, [query])

  const Current = demos[active]?.Component

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandDot} />
          <div>
            <div className={styles.brandTitle}>UI Kit</div>
            <div className={styles.brandSub}>over Base UI</div>
          </div>
        </div>

        <input
          className={styles.search}
          placeholder="Search components…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <nav className={styles.nav}>
          {filtered.map((d) => (
            <button
              key={d.title}
              className={cn(styles.navItem, d.i === active && styles.navItemActive)}
              onClick={() => setActive(d.i)}
            >
              {d.title}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className={styles.empty}>No matches</div>
          )}
        </nav>

        <div className={styles.sidebarFooter}>
          <span>{demos.length} components</span>
          <button className={styles.themeBtn} onClick={toggle}>
            {dark ? "☀ Light" : "☾ Dark"}
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.title}>{demos[active]?.title}</h1>
        </header>
        <div className={styles.stage}>{Current && <Current />}</div>
      </main>
    </div>
  )
}
