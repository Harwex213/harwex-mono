import { Tabs } from "./Tabs"

export const meta = { title: "Tabs" }

export default function TabsDemo() {
  return (
    <Tabs.Root defaultValue="overview">
      <Tabs.List>
        <Tabs.Tab value="overview">Overview</Tabs.Tab>
        <Tabs.Tab value="activity">Activity</Tabs.Tab>
        <Tabs.Tab value="settings">Settings</Tabs.Tab>
        <Tabs.Indicator />
      </Tabs.List>
      <Tabs.Panel value="overview">
        A snapshot of your workspace: recent deploys, open pull requests, and
        team activity all in one place.
      </Tabs.Panel>
      <Tabs.Panel value="activity">
        Every push, comment, and review shows up here in chronological order so
        nothing slips through the cracks.
      </Tabs.Panel>
      <Tabs.Panel value="settings">
        Manage members, tune notification preferences, and rotate access tokens
        for your integrations.
      </Tabs.Panel>
    </Tabs.Root>
  )
}
