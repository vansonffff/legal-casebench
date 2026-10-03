export const PACKAGE = 'dsh-legal-casebench';
export const NAMESPACE = 'casebench';
export const INVOCATIONS = Object.freeze([
  { method: 'status', implementation: 'remoteStatus', parameters: [] },
  { method: 'workspace', implementation: 'remoteWorkspace', parameters: [] },
  { method: 'matter', implementation: 'remoteMatter', parameters: [{ name: 'args' }] },
  // 只读案件上下文与引用快照；三个方法都不创建或恢复 Agent，也不修改案件状态。
  { method: 'context', implementation: 'remoteContext', parameters: [{ name: 'args' }] },
      { method: 'followSession', implementation: 'remoteFollowSession', parameters: [{ name: 'args' }] },
  { method: 'quoteIssue', implementation: 'remoteQuoteIssue', parameters: [{ name: 'args' }] },
  { method: 'reference', implementation: 'remoteReference', parameters: [{ name: 'args' }] },
  { method: 'practiceList', implementation: 'remotePracticeList', parameters: [] },
  { method: 'practiceShow', implementation: 'remotePracticeShow', parameters: [{ name: 'args' }] },
  // 面板唯一的写方法：待办状态写回（open/completed），落盘保护在 Core pending.py。
  { method: 'setPendingStatus', implementation: 'remoteSetPendingStatus', parameters: [{ name: 'args' }] },
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
