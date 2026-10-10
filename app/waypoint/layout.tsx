import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./waypoint.css";

export const metadata: Metadata = {
  title: "Waypoint | Evan Miles",
  description: "Your private investment research workspace.",
  robots: { index: false, follow: false },
};

export default function WaypointLayout({ children }: { children: ReactNode }) {
  return <div className="waypoint-app">{children}</div>;
}
