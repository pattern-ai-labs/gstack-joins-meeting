import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Provider as AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/lib/toast";
import { Shell } from "@/components/Shell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans-loaded",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "gstack joins your meeting — voice agents for every gstack specialist",
  description: "Bring CEO, CSO, QA Lead, Senior Designer, and 15 more gstack specialists into your Google Meet as real voice bots with their own 3D avatars. Open source, MIT, free forever.",
  openGraph: {
    title: "gstack joins your meeting",
    description: "Every gstack specialist as a real voice bot in your Google Meet. Built on Garry Tan's open-source personas.",
    url: "https://gstack-joins-meeting.vercel.app",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "gstack joins your meeting",
    description: "Every gstack specialist as a real voice bot in your Meet.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
        <body>
          <ToastProvider>
            <Shell>{children}</Shell>
          </ToastProvider>
        </body>
      </html>
    </AuthProvider>
  );
}
