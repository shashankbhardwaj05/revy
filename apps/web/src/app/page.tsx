"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { API_BASE_URL } from "../lib/api";

export default function HomePage() {
  const router = useRouter();
  const [meetingUrl, setMeetingUrl] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl, title: title || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = Array.isArray(body.message)
          ? body.message.join(", ")
          : body.message ?? `Request failed (${res.status})`;
        throw new Error(message);
      }
      router.push("/meetings");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "80px auto", padding: "0 24px" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Revy Notetaker" style={{ height: 48, marginBottom: 20 }} />
      <p style={{ color: "#555", lineHeight: 1.6 }}>
        Paste a Google Meet link. A bot joins, records, and transcribes — the
        finished meeting lands in your{" "}
        <Link href="/meetings">meeting library</Link>.
      </p>

      <form onSubmit={onSubmit} style={{ marginTop: 32, display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 14, color: "#333" }}>Google Meet link</span>
          <input
            type="url"
            required
            placeholder="https://meet.google.com/xxx-xxxx-xxx"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            style={{ padding: 10, fontSize: 15, border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 14, color: "#333" }}>Title (optional)</span>
          <input
            type="text"
            placeholder="Weekly sync"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ padding: 10, fontSize: 15, border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "10px 16px",
            fontSize: 15,
            borderRadius: 6,
            border: "none",
            background: submitting ? "#999" : "#111",
            color: "#fff",
            cursor: submitting ? "default" : "pointer",
          }}
        >
          {submitting ? "Sending bot…" : "Start recording"}
        </button>
        {error && <p style={{ color: "#c00", fontSize: 14 }}>{error}</p>}
      </form>

      <p style={{ color: "#999", fontSize: 14, marginTop: 24 }}>
        API health: <code>{API_BASE_URL}/healthz</code>
      </p>
    </main>
  );
}
