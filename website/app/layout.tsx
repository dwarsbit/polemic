import type { Metadata } from "next";
import { Provider } from "@/components/provider";
import "./global.css";

export const metadata: Metadata = {
  // Absolute base for Open Graph image URLs; set SITE_URL when building for production.
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Polemic — the local-first LaTeX editor",
    template: "%s · Polemic",
  },
  description:
    "An open source LaTeX editor with live PDF preview, compiled on your own machine with your own TeX distribution.",
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
