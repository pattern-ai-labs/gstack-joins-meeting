import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Provider as AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/lib/toast";
import { Sidebar } from "@/components/Sidebar";

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
  title: "gstack — bring your engineering team into the meeting",
  description: "Drop any gstack specialist into your Google Meet as a voice bot with its own avatar. Powered by your Claude Code session.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
        <body>
          <ToastProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <div className="flex-1 min-w-0">{children}</div>
            </div>
          </ToastProvider>
        </body>
      </html>
    </AuthProvider>
  );
}
