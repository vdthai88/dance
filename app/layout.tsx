import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "One — Dance practice, with direction",
  description: "Review a dance practice video and explore technique feedback.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
