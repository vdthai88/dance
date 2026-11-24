/** Read API JSON without exposing HTML error pages or raw response bodies. */
export async function readApiJson(response: Response, operation: string, fallback?: string): Promise<unknown> {
  let body = '';
  let result: unknown;
  try {
    body = await response.text();
    if (!body.trim()) throw new Error('Empty response');
    result = JSON.parse(body);
    if (fallback && result === null) throw new Error('Missing response');
  } catch {
    if (fallback) {
      const hint = response.status === 401 ? ' Sign in again, then retry.' : '';
      throw new Error(`${fallback} (HTTP ${response.status})${hint}`);
    }
    const hint = response.status === 413
      ? 'The upload was rejected as too large. Try a smaller video.'
      : response.status === 401 || response.status === 403
        ? 'Sign in again, then retry.'
        : response.status === 502 || response.status === 503 || response.status === 504
          ? 'The server may have restarted, timed out, or become unavailable. Check Render Logs for this request, then retry with a smaller video.'
          : 'Check Render Logs for this request before retrying.';
    throw new Error(`${operation}: the server returned ${body.trim() ? 'a non-JSON' : 'an empty'} response (HTTP ${response.status}). ${hint}`);
  }
  if (!response.ok) {
    const error = result && typeof result === 'object' && 'error' in result ? result.error : undefined;
    throw new Error(typeof error === 'string' && error.trim() ? error : fallback ? `${fallback} (HTTP ${response.status})` : `${operation} failed (HTTP ${response.status}).`);
  }
  return result;
}
