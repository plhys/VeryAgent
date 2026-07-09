export default function PetLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        overflow: "hidden",
      }}
    >
      <style>{`html, body { background: transparent !important; overflow: hidden !important; }`}</style>
      {children}
    </div>
  )
}
