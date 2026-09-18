import { RequestError } from './decision';

export function providerKey(value: unknown, provider: 'Jev' | 'OpenAI'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:=+\/~\-]{16,512}$/.test(value.trim())) throw new RequestError(`Add your ${provider} API key in Connections.`, 401);
  return value.trim();
}
