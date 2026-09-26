import { PACKAGE, descriptors } from './src/remote/invocations.js';
export const TYPERT_REMOTE = {
  package: PACKAGE,
  descriptors: descriptors(() => ({ mode: 'strict', parse: (value) => value })),
};
export default TYPERT_REMOTE;
