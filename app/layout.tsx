import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "M2SG — Statut des services",
  description: "Disponibilité en temps réel de m2sg.com et du service mail.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
