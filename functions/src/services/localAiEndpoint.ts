// Operational standalone AI is on localhost. Never accept a browser-supplied
// URL or host. DEV preview has its own isolated service and explicit port.
export function localAiPort(): number {
  const raw = process.env.AI_LOCAL_PORT ?? '5010';
  if (!/^[0-9]{4,5}$/.test(raw)) {
    throw new Error('AI_LOCAL_PORT must be a numeric loopback port');
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('AI_LOCAL_PORT is outside permitted range');
  }
  return port;
}

export function localAiUrl(path: '/dashboard/summary' | '/hst/proposals' | '/hst/approvals'): string {
  return `http://127.0.0.1:${localAiPort()}${path}`;
}
