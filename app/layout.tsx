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
  themeColor: "#04070e",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        {/* Mobile-constraint shell, lit like an instrument panel. */}
        <div className="cockpit-shell relative mx-auto min-h-screen max-w-md overflow-hidden pb-24 shadow-[0_0_80px_-20px_rgba(56,189,248,0.35)]">
          {children}
        </div>
      </body>
    </html>
  );
}
