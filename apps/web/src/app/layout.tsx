import "./globals.css";
import AppShell from "@/components/AppShell";
import SessionGuard from "@/components/SessionGuard";
import EmbedHeight from "@/components/EmbedHeight";
import { ThemeProvider } from "@/lib/theme";

export const metadata = { title: "Maung CRM — Field Activities" };
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        {/* skrip statis (bukan inline): pasang tema & warna brand sebelum render pertama */}
        <script src="/crm/theme-init.js" />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-800">
        <ThemeProvider>
          <SessionGuard />
          <EmbedHeight />
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
