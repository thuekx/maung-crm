import "./globals.css";
import Nav from "@/components/Nav";

export const metadata = { title: "Maung CRM — Field Activities" };
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <Nav />
        <main className="mx-auto max-w-3xl p-4">{children}</main>
      </body>
    </html>
  );
}
