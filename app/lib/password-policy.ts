export const passwordGuidance = "Use 8–128 characters, including an uppercase letter, a number, and a special character such as !, @, or #.";
const characterRequirements = [
  { label: "At least one uppercase letter (A–Z)", pattern: /[A-Z]/u },
  { label: "At least one number (0–9)", pattern: /[0-9]/u },
  { label: "At least one special character (such as !, @, or #)", pattern: /[^\p{L}\p{N}\s]/u },
];
const lengthPattern = /.{8,128}/u.source;
const fullLengthPattern = new RegExp(`^${lengthPattern}(?![\\s\\S])`, "u");
export const passwordPattern = characterRequirements.map(({ pattern }) => `(?=.*${pattern.source})`).join("") + lengthPattern;
const strongPassword = new RegExp(`^(?:${passwordPattern})(?![\\s\\S])`, "u");

export function getPasswordRequirements(password: string) {
  return [
    { label: "8–128 characters", met: password.length <= 128 && fullLengthPattern.test(password) },
    ...characterRequirements.map(({ label, pattern }) => ({ label, met: pattern.test(password) })),
  ];
}

export function meetsPasswordPolicy(password: unknown): password is string {
  return typeof password === "string" && password.length <= 128 && strongPassword.test(password);
}

export function passwordEntryError(password: FormDataEntryValue | null, confirmation: FormDataEntryValue | null) {
  if (!meetsPasswordPolicy(password)) return "weak-password";
  if (password !== confirmation) return "password-mismatch";
  return null;
}

export const passwordEntryMessages: Record<string, string> = {
  "weak-password": passwordGuidance,
  "password-mismatch": "The passwords don’t match. Enter the same password in both fields.",
};
