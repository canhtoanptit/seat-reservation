import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seat Reservation",
  description: "Reserve one of three seats.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        {children}
      </body>
    </html>
  );
}
