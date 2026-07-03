"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { MeetingSummary, Utterance } from "@notetaker/contracts";
import { API_BASE_URL } from "../../../lib/api";

/**
 * Only these two are true dead ends in the lifecycle (see webhooks.service.ts's
 * STATUS_ORDER) — meeting_ended/processing/synced_to_hubspot are waypoints on the way
 * to completed, not final states, so polling must continue through them.
 */
const TERMINAL_STATUSES: MeetingSummary["status"][] = ["completed", "failed"];

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const [meeting, setMeeting] = useState<MeetingSummary | null>(null);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const [meetingRes, transcriptRes] = await Promise.all([
          fetch(`${API_BASE_URL}/meetings/${params.id}`),
          fetch(`${API_BASE_URL}/meetings/${params.id}/transcript`),
        ]);
        if (!meetingRes.ok) throw new Error(`Failed to load meeting (${meetingRes.status})`);
        if (!transcriptRes.ok) throw new Error(`Failed to load transcript (${transcriptRes.status})`);
        const meetingData: MeetingSummary = await meetingRes.json();
        const transcriptData: Utterance[] = await transcriptRes.json();
        if (cancelled) return;
        setMeeting(meetingData);
        setUtterances(transcriptData);
        setError(null);
        if (!TERMINAL_STATUSES.includes(meetingData.status)) {
          timer = setTimeout(poll, 2000);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        // A transient failure (network blip, momentary 5xx) shouldn't permanently kill
        // live updates for the rest of the meeting — keep retrying until the page
        // unmounts or a poll succeeds again.
        timer = setTimeout(poll, 2000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [params.id]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [utterances.length]);

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 24px" }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/meetings">&larr; Meeting library</Link>
      </p>

      {error && <p style={{ color: "#c00", fontSize: 14 }}>{error}</p>}

      {meeting && (
        <>
          <h1 style={{ fontSize: 22, marginBottom: 4 }}>{meeting.title ?? meeting.meetingUrl}</h1>
          <p style={{ fontSize: 13, color: "#777", marginBottom: 20 }}>
            Status: <strong>{meeting.status.replace(/_/g, " ")}</strong>
            {!TERMINAL_STATUSES.includes(meeting.status) && " — live"}
          </p>

          <div
            style={{
              border: "1px solid #e3e3e3",
              borderRadius: 8,
              padding: 16,
              minHeight: 200,
              maxHeight: 500,
              overflowY: "auto",
              display: "grid",
              gap: 10,
            }}
          >
            {utterances.length === 0 ? (
              <p style={{ color: "#999", fontSize: 14 }}>
                {TERMINAL_STATUSES.includes(meeting.status)
                  ? "No transcript captured for this meeting."
                  : "Waiting for the bot to join and start transcribing…"}
              </p>
            ) : (
              utterances.map((u) => (
                <div key={u.seq}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{u.speaker}: </span>
                  <span style={{ fontSize: 14 }}>{u.text}</span>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </>
      )}
    </main>
  );
}
