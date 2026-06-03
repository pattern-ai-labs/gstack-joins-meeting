import "./globals.css";
import type { Metadata } from "next";
import { Provider as AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/lib/toast";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "gstack — bring your engineering team into the meeting",
  description: "Drop any gstack specialist into your Google Meet as a voice bot with its own avatar. Powered by your Claude Code session.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <html lang="en">
        <head>
          <link rel="preconnect" href="https://rsms.me/" />
          <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
        </head>
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
