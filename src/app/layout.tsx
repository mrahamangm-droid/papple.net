import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Papple.net — Global Advisory, Construction Intelligence & Verified Expert Network",
  description:
    "Papple Holdings Advisory Network — construction and infrastructure advisory, applied AI research for project delivery, and the AI-GCLM leadership framework.",
  metadataBase: new URL("https://papple.net"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-paper font-sans text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
