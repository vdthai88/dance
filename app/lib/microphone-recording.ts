export function microphoneRecordingError(capabilities: {
  secureContext: boolean;
  microphoneAvailable: boolean;
  recorderAvailable: boolean;
}): string | null {
  if (!capabilities.secureContext) {
    return "Microphone recording requires HTTPS. Open One Dance using its HTTPS address. A local Wi-Fi address starting with http:// cannot access the microphone on your iPhone.";
  }
  if (!capabilities.microphoneAvailable) {
    return "Microphone access is unavailable in this browser or embedded view. Open this HTTPS page directly in Safari and allow microphone access for this site.";
  }
  if (!capabilities.recorderAvailable) {
    return "Audio recording is unavailable in this browser. Update your browser and open this page directly in Safari or another current browser.";
  }
  return null;
}
