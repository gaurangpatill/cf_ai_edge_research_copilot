import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Edge Research Copilot",
  description:
    "Upload research material, retrieve relevant context with vector search, and chat with persistent memory through a modern web interface."
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-[family:var(--font-sans)] antialiased">
        {children}
      </body>
    </html>
  );
}
