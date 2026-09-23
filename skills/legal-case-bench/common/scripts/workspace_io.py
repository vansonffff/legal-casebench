#!/usr/bin/env python3
"""多端案件工作区的共享锁、哈希、原子写入和敏感字段清理。"""

from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

HARNESSES = {"workbuddy", "myagents", "codex", "dsh", "migration", "unknown"}
SENSITIVE_KEY = re.compile(
    r"(?:authorization|api[-_]?key|cookie|token|secret|credential|client[-_]?secret)",
    re.IGNORECASE,
)
SENSITIVE_TEXT = re.compile(
    r"(?i)(authorization\s*[:=]\s*|bearer\s+|api[-_]?key\s*[:=]\s*|cookie\s*[:=]\s*)([^\s,;]+)"
)


def sha256_file(path: str | Path) -> str:
    target = Path(path)
    digest = hashlib.sha256()
    with target.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_digest(path: str | Path) -> str:
    target = Path(path)
    return hashlib.sha256(target.read_bytes() if target.exists() else b"").hexdigest()


@contextlib.contextmanager
def workspace_lock(directory: str | Path) -> Iterator[None]:
    base = Path(directory)
    base.mkdir(parents=True, exist_ok=True)
    lock_path = base / ".case-bench.lock"
    with lock_path.open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def atomic_write(path: str | Path, content: bytes, expected: str | None = None) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink():
        raise ValueError(f"拒绝替换符号链接：{target}")
    if expected is not None and file_digest(target) != expected:
        raise RuntimeError(f"文件已被其他写入者修改：{target}")
    fd, pending = tempfile.mkstemp(prefix=".case-bench-pending-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if target.exists():
            os.chmod(pending, target.stat().st_mode & 0o777)
        if expected is not None and file_digest(target) != expected:
            raise RuntimeError(f"保存前发现外部修改：{target}")
        os.replace(pending, target)
    finally:
        if os.path.exists(pending):
            os.unlink(pending)


def load_json(path: str | Path, default: Any = None) -> Any:
    target = Path(path)
    if not target.exists():
        return default
    return json.loads(target.read_text(encoding="utf-8"))


def dump_json_bytes(data: Any) -> bytes:
    return (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def writer_record(actor: str, operation_id: str = "") -> dict[str, str]:
    if actor not in HARNESSES:
        raise ValueError(f"未知 harness：{actor}")
    result = {
        "harness": actor,
        "written_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    if operation_id:
        result["operation_id"] = operation_id
    return result


def sanitize(value: Any) -> Any:
    """递归删除敏感键，并遮盖文本中常见认证片段。"""
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if SENSITIVE_KEY.search(str(key)) else sanitize(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str):
        return SENSITIVE_TEXT.sub(lambda match: match.group(1) + "[REDACTED]", value)
    return value


def has_unredacted_sensitive_text(text: str) -> bool:
    """检测仍带值的常见认证片段；已写成 [REDACTED] 的内容允许保留。"""
    for match in SENSITIVE_TEXT.finditer(text):
        value = match.group(2).strip().strip('"\'')
        if not value.startswith("[REDACTED]"):
            return True
    return False


def assert_redacted_tree(root: str | Path) -> None:
    """在成果登记前复检 raw 目录，防止绕过 save-raw 手工写入凭据。"""
    base = Path(root)
    for path in base.rglob("*"):
        if not path.is_file():
            continue
        if SENSITIVE_KEY.search(path.name):
            raise ValueError(f"raw 目录含疑似凭据文件名：{path}")
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if has_unredacted_sensitive_text(text):
            raise ValueError(f"raw 响应仍含未脱敏认证信息：{path}")


def append_note(case_dir: str | Path, text: str) -> None:
    path = Path(case_dir) / "00-案件笔记.md"
    with workspace_lock(case_dir):
        before = path.read_text(encoding="utf-8") if path.exists() else f"# {Path(case_dir).name}案件笔记\n"
        if before and not before.endswith("\n"):
            before += "\n"
        atomic_write(path, (before + "\n" + text.rstrip() + "\n").encode("utf-8"), file_digest(path))
