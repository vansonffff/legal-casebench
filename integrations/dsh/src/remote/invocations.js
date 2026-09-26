export const PACKAGE = 'dsh-legal-casebench';
export const NAMESPACE = 'casebench';
export const INVOCATIONS = Object.freeze([
  { method: 'status', implementation: 'remoteStatus', parameters: [] },
  { method: 'workspace', implementation: 'remoteWorkspace', parameters: [] },
  { method: 'matter', implementation: 'remoteMatter', parameters: [{ name: 'args' }] },
  { method: 'practiceList', implementation: 'remotePracticeList', parameters: [] },
  { method: 'practiceShow', implementation: 'remotePracticeShow', parameters: [{ name: 'args' }] },
]);

export function descriptors(schema) {
  return INVOCATIONS.map((entry) => ({
    id: `${PACKAGE}#${NAMESPACE}/${entry.method}`,
    service: NAMESPACE,
    namespace: NAMESPACE,
    method: entry.method,
    implementation: entry.implementation,
    invocation: { kind: 'direct' },
    parameters: entry.parameters.map((parameter) => ({
      name: parameter.name,
      wire: parameter.name,
      source: 'json',
      acceptsUndefined: false,
      codec: { mode: 'strict', typeSymbol: `${PACKAGE}#${NAMESPACE}/${entry.method}:${parameter.name}`,
        create: () => schema('object') },
    })),
    result: { mode: 'strict', typeSymbol: `${PACKAGE}/${NAMESPACE}#${entry.method}:result`,
      create: () => schema('object') },
  }));
}
