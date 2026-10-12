import "./globals.css";
import Nav from "@/components/Nav";
import SessionGuard from "@/components/SessionGuard";
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
          <Nav />
          <main className="mx-auto max-w-3xl p-4 print:max-w-none print:p-0">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
