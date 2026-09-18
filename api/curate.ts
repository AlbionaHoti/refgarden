import { handleCuration } from '../src/hosted-api';
export default { fetch: (request: Request) => handleCuration(request) };
