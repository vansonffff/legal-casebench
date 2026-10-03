import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

/** v2 标识携带身份与路径；旧标识仅供兼容历史消息。 */
export function parseReferences(text) {
  const found = [];
  for (const match of String(text).matchAll(/【案件引用：\s*([^·】]+?)\s*·\s*(ISS-\d{4,})\s*(?:·([^】]*))?】/g)) {
    const [, name, issueId, tail = ''] = match;
    const encoded = tail.match(/(?:^|·)\s*v2:([^\s·]+)\s*$/);
    if (tail.includes('v2:') && !encoded) continue;
    if (encoded) {
      try {
        const value = JSON.parse(decodeURIComponent(encoded[1]));
        if (typeof value.matterId !== 'string' || !value.matterId || typeof value.matterPath !== 'string'
          || !isAbsolute(value.matterPath) || value.issueId !== issueId || !/^[a-f0-9]{64}$/.test(value.expectedHash)) continue;
        found.push({ name: name.trim(), issueId, ...value, key: `v2:${encoded[1]}` });
      } catch { /* 用户编辑后格式失效，保留原消息而不猜测引用。 */ }
    } else found.push({ name: name.trim(), issueId, key: `${name.trim()}|${issueId}` });
  }
  return found;
}

export function referenceKey(reference, messageId) {
  return reference.matterId ? createHash('sha256').update(`${messageId}|${reference.key}`).digest('hex') : reference.key;
}

/** 消息身份必须包含案件和原用户消息，避免跨案同号及重试失败消息碰撞。 */
export function referenceMessageId(key, failed = false) {
  return `casebench-reference-${failed ? 'failed-' : ''}${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

export function referenceAnchor(key) {
  return `〔引用身份：${encodeURIComponent(key)}〕`;
}

export function persistedReferenceKeys(events) {
  const found = new Set();
  for (const event of events) {
    if (event?.type !== 'user/message' || event.data?.source?.kind !== 'casebench-reference') continue;
    const text = textOf(event.data);
    const v2 = text.match(/〔引用身份：([^〕]+)〕/);
    if (v2) { try { found.add(decodeURIComponent(v2[1])); } catch {} }
    else {
      const legacy = text.match(/〔引用锚点：([^·〕]+)·\s*(ISS-\d{4,})/);
      if (legacy) found.add(`${legacy[1].trim()}|${legacy[2]}`);
    }
  }
  return found;
}

export function textOf(message) {
  return Array.isArray(message?.content)
    ? message.content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n') : '';
}

/** 仅识别已发送用户消息，草稿、模型消息、引用快照都不作为关联来源。 */
export function latestReferences(events) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type !== 'user/message' || event.data?.source?.kind !== 'user') continue;
    const refs = parseReferences(textOf(event.data));
    if (refs.length) return [...new Map(refs.map((ref) => [ref.matterId || ref.name, ref])).values()];
  }
  return [];
}
