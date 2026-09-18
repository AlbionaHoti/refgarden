import { handleConnection } from '../src/hosted-api';
export default { fetch: (request: Request) => handleConnection(request) };
