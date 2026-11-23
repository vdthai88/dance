"use client";

import { useId, useState } from "react";
import type { FormEventHandler } from "react";

export function PasswordField({ autoComplete = "current-password", minLength, maxLength, name = "password", label = "Password", pattern, describedBy, onInput }: {
  autoComplete?: "current-password" | "new-password";
  minLength?: number;
  maxLength?: number;
  name?: string;
  label?: string;
  pattern?: string;
  describedBy?: string;
  onInput?: FormEventHandler<HTMLInputElement>;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const action = `${visible ? "Hide" : "Show"} ${label.toLowerCase()}`;

  return <div className="password-field">
    <label htmlFor={id}>{label}</label>
    <div className="password-input-wrap">
      <input id={id} name={name} type={visible ? "text" : "password"} autoComplete={autoComplete} minLength={minLength} maxLength={maxLength} pattern={pattern} aria-describedby={describedBy} onInput={onInput} required />
      <button className="password-visibility" type="button" title={action} aria-label={action} aria-controls={id} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
  </div>;
}
