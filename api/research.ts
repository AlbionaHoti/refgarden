import { handleResearch } from '../src/hosted-api';
export default { fetch: (request: Request) => handleResearch(request) };
