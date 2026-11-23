"use client";

import type { FormEvent } from "react";
import { useId, useState } from "react";
import { PasswordField } from "./password-field";
import { getPasswordRequirements, passwordEntryMessages, passwordPattern } from "../lib/password-policy";

function validateConfirmation(event: FormEvent<HTMLInputElement>) {
  const fields = event.currentTarget.form?.elements;
  const password = fields?.namedItem("password");
  const confirmation = fields?.namedItem("confirmPassword");
  if (!(password instanceof HTMLInputElement) || !(confirmation instanceof HTMLInputElement)) return;
  const mismatched = confirmation.value !== "" && confirmation.value !== password.value;
  confirmation.setCustomValidity(mismatched ? passwordEntryMessages["password-mismatch"] : "");
}

export function NewPasswordFields({ label = "Password" }: { label?: string }) {
  const guidanceId = useId();
  const [requirements, setRequirements] = useState(() => getPasswordRequirements(""));

  function handlePasswordInput(event: FormEvent<HTMLInputElement>) {
    setRequirements(getPasswordRequirements(event.currentTarget.value));
    validateConfirmation(event);
  }

  return <>
    <PasswordField label={label} autoComplete="new-password" minLength={8} maxLength={128} pattern={passwordPattern} describedBy={guidanceId} onInput={handlePasswordInput} />
    <div id={guidanceId} className="password-requirements">
      <p>Password requirements</p>
      <ul role="list">
        {requirements.map(({ label, met }) => <li key={label} data-met={met}>
          <span aria-hidden="true">{met ? "✓" : "○"}</span>
          <span>{label}<span className="visually-hidden">{met ? ", met" : ", not met"}</span></span>
        </li>)}
      </ul>
    </div>
    <PasswordField label="Confirm password" name="confirmPassword" autoComplete="new-password" maxLength={128} onInput={validateConfirmation} />
  </>;
}
