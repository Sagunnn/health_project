import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BESAFE by AIMS — Know before you take it",
  description:
    "Scan medication and supplement labels, check them against the WADA Prohibited List in your competition context, and keep a private Athlete Passport.",
  applicationName: "BESAFE by AIMS",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        {/* Mobile-constraint shell — DESIGN.md §2 */}
        <div className="relative mx-auto min-h-screen max-w-md bg-slate-50 pb-20 shadow-2xl">
          {children}
        </div>
      </body>
    </html>
  );
}
