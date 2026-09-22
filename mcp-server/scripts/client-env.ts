// The SDK only inherits a small set of system variables by default.
// Forward this adapter's configuration explicitly to its stdio child.
export const clientEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string,string] =>
    entry[0].startsWith('PLASTICITY_') && entry[1] !== undefined),
);
