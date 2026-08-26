import { declareRouteAccess } from './route-access.decorator';

/** Mark an operation as available to every signed-in BetterSpend user. */
export const Authenticated = () => declareRouteAccess({ kind: 'authenticated' });
