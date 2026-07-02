export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 28 }}>🎙️ AI Notetaker</h1>
      <p style={{ color: "#555", lineHeight: 1.6 }}>
        Skeleton is up. The paste-a-link page arrives in Phase&nbsp;2 — for now
        this page just proves the web app boots.
      </p>
      <p style={{ color: "#999", fontSize: 14 }}>
        API health: <code>http://localhost:4000/healthz</code>
      </p>
    </main>
  );
}
