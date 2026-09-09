/* Stands in for packages this page never uses: Stripe funding and the memo
   program. Privy's Solana module imports them for features we do not touch.

   A Proxy rather than an empty object, so that if any of it is ever actually
   reached it fails by name instead of as "undefined is not a function". */
const boom = (name) => new Proxy(function () {}, {
  get: (_t, k) => {
    if (k === '__esModule') return true;
    if (typeof k === 'symbol') return undefined;
    return boom(`${name}.${String(k)}`);
  },
  apply: () => { throw new Error(`${name} is not bundled into the withdraw page`); },
  construct: () => { throw new Error(`${name} is not bundled into the withdraw page`); },
});
const stub = boom('stubbed');
export default stub;
export const loadStripe = stub.loadStripe;
export const extendClient = stub.extendClient;
export const getAddMemoInstruction = stub.getAddMemoInstruction;
