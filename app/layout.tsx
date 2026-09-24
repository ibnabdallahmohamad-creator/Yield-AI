import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], axes: ["opsz"] });

export const metadata: Metadata = {
  title: {
    default: "Yield AI — The AI-Powered CRM for Agribusinesses",
    template: "%s · Yield AI",
  },
  description:
    "Soil probes, satellite maps and an agronomist AI for farms in Qatar — salinity, irrigation and crop decisions grounded in FAO science. Open-source and free.",
  applicationName: "Yield AI",
};

export const viewport: Viewport = {
  themeColor: "#1f5a3d",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
