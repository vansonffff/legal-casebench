import { z } from 'zod';
import { PACKAGE, INVOCATIONS, NAMESPACE, descriptors } from './src/remote/invocations.js';

export const TYPERT = {
  package: PACKAGE,
  face: 'host',
  schemas: [],
  invocations: descriptors(() => z.record(z.string(), z.unknown())),
  model: { services: [], events: [], objects: [] },
};
export { INVOCATIONS, NAMESPACE };
