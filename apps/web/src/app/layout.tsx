import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Revy Notetaker",
  description: "Internal meeting transcriber",
  icons: { icon: "/logo.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          margin: 0,
          background: "#fafafa",
          color: "#1a1a1a",
        }}
      >
        {children}
      </body>
    </html>
  );
}
