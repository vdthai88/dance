import type { ReactNode } from "react";

export function ProfileSection({ title, className = "", nested = false, children }: {
  title: string;
  className?: string;
  nested?: boolean;
  children: ReactNode;
}) {
  return <details className={`profile-disclosure ${nested ? "profile-wide profile-disclosure-nested" : "profile-form"} ${className}`}>
    <summary>{title}</summary>
    <div className="profile-disclosure-content">{children}</div>
  </details>;
}
