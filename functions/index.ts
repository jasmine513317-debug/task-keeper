// Qoder Sites hands every request to Deno.serve. createSiteContext wraps it with the
// platform's request id and strips platform credentials; the route table below only ever
// sees business paths under the Function prefix.
import { createDatabaseClient, createSiteContext, errorResponse } from './_qoder/backend.mjs';
import { application } from './routes.mjs';

const handle = application({ db: createDatabaseClient() });

Deno.serve(async (request) => {
  let context;
  try {
    context = createSiteContext(request, { forwardApplicationCredentials: true });
    // The account cookie is read from the untouched request object: an older Worker SDK
    // silently ignores forwardApplicationCredentials and would hand us a cookie-less copy.
    return await handle(context, request);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});
