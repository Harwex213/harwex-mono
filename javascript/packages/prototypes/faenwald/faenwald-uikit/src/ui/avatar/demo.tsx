import { Avatar } from "./Avatar"

export const meta = { title: "Avatar" }

const row = {
  display: "flex",
  gap: "var(--uk-space-4)",
  alignItems: "center",
  flexWrap: "wrap" as const,
}

export default function AvatarDemo() {
  return (
    <div style={row}>
      <Avatar.Root>
        <Avatar.Image
          src="https://images.unsplash.com/photo-1543610892-0b1f7e6d8ac1?w=128&h=128&dpr=2&q=80"
          width="40"
          height="40"
          alt="Colm Tuite"
        />
        <Avatar.Fallback delay={600}>CT</Avatar.Fallback>
      </Avatar.Root>

      <Avatar.Root>
        <Avatar.Image src="https://invalid.example/broken.png" alt="Ada Lovelace" />
        <Avatar.Fallback>AL</Avatar.Fallback>
      </Avatar.Root>

      <Avatar.Root>
        <Avatar.Fallback>UK</Avatar.Fallback>
      </Avatar.Root>
    </div>
  )
}
