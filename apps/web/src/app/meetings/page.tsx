import Link from "next/link";
import type { MeetingSummary } from "@notetaker/contracts";
import { API_BASE_URL } from "../../lib/api";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<MeetingSummary["status"], string> = {
  created: "#999",
  scheduled: "#999",
  bot_joining: "#b8860b",
  bot_joined: "#b8860b",
  recording: "#c00",
  transcribing: "#c00",
  meeting_ended: "#0066cc",
  processing: "#0066cc",
  completed: "#0a8f3c",
  failed: "#c00",
};

async function fetchMeetings(): Promise<MeetingSummary[]> {
  const res = await fetch(`${API_BASE_URL}/meetings`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load meetings (${res.status})`);
  return res.json();
}

export default async function MeetingsPage() {
  const meetings = await fetchMeetings();

  return (
    <main style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px" }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/">&larr; New meeting</Link>
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Revy Notetaker" style={{ height: 32, marginBottom: 12 }} />
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Meeting library</h1>

      {meetings.length === 0 ? (
        <p style={{ color: "#777" }}>No meetings yet — paste a link to get started.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {meetings.map((m) => (
            <Link
              key={m.id}
              href={`/meetings/${m.id}`}
              style={{
                border: "1px solid #e3e3e3",
                borderRadius: 8,
                padding: 14,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{m.title ?? m.meetingUrl}</div>
                <div style={{ fontSize: 13, color: "#777" }}>
                  {new Date(m.createdAt).toLocaleString()}
                </div>
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: STATUS_COLORS[m.status],
                  textTransform: "uppercase",
                }}
              >
                {m.status.replace("_", " ")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
