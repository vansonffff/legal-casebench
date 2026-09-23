#!/usr/bin/env python3
"""复核卡台账：列 pending、校验哈希绑定、置状态。

无队列设计——文件系统即唯一事实源。复核会话开工先跑 --list 找 pending，
再跑 --verify 确认被核对象未被改动（改动即置 invalidated，拒绝基于旧哈希复核）。

用法:
  # 列出某案件的复核卡（默认只列 pending）
  python3 check_review.py --list --case "<案件名>" [--all]

  # 校验某张卡的哈希绑定（被核对象/材料被改动则置 invalidated）
  python3 check_review.py --verify --card "<...>.request.json"
  python3 check_review.py --verify --case "<案件名>"

  # 置状态（pending / running / done / invalidated）
  python3 check_review.py --set-status done --card "<...>.request.json"

退出码:
  0 正常
  1 校验发现失效（status 已置 invalidated）
  3 参数或路径错误
"""
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from workspace_io import atomic_write, dump_json_bytes, file_digest, workspace_lock


def sha256_of(path: str):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_cards(case_dir: str):
    """扫描 01-过程稿/*/30-复核/*.request.json"""
    cards = []
    proc = os.path.join(case_dir, "01-过程稿")
    if not os.path.isdir(proc):
        return cards
    for task in sorted(os.listdir(proc)):
        rd = os.path.join(proc, task, "30-复核")
        if not os.path.isdir(rd):
            continue
        for fn in sorted(os.listdir(rd)):
            if fn.endswith(".request.json"):
                cards.append(os.path.join(rd, fn))
    return cards


def load(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path: str, data) -> None:
    target = Path(path)
    with workspace_lock(target.parent):
        atomic_write(target, dump_json_bytes(data), file_digest(target))


def cmd_list(case_dir: str, show_all: bool) -> int:
    cards = find_cards(case_dir)
    if not cards:
        print(f"（无复核卡）{case_dir}")
        return 0
    rows = []
    for p in cards:
        d = load(p)
        if not show_all and d.get("status") != "pending":
            continue
        rows.append((d.get("created_at", ""), d.get("card_id", "?"), d.get("type", "?"),
                     d.get("status", "?"), d.get("proposition", "")[:40], d.get("task", ""), p))
    if not rows:
        print("（无 pending 复核卡）")
        return 0
    rows.sort()
    print(f"{'card_id':<20}{'T':<3}{'status':<13}{'任务':<18}命题")
    print("-" * 96)
    for _, cid, t, st, prop, task, _ in rows:
        print(f"{cid:<20}{t:<3}{st:<13}{task:<18}{prop}")
    print(f"\n共 {len(rows)} 张。取卡：读对应 .card.md；校验：check_review.py --verify --card <...>.request.json")
    return 0


def verify_one(path: str) -> bool:
    """返回 True=绑定有效；False=已失效（并写回 invalidated）。"""
    d = load(path)
    changed = []

    def cmp(entry, label):
        if not entry or not entry.get("path"):
            return
        p = entry["path"]
        if not os.path.exists(p):
            changed.append(f"{label} 文件已不存在：{p}")
            return
        now = sha256_of(p)
        old = entry.get("sha256")
        if old and now != old:
            changed.append(f"{label} 内容已变更：{p}\n      旧 {old[:16]}…  新 {now[:16]}…")

    cmp(d.get("target"), "被核对象")
    for m in d.get("materials", []):
        cmp(m, "材料")

    if changed and d.get("status") not in ("invalidated",):
        d["status"] = "invalidated"
        d["invalidated_at"] = datetime.now().isoformat(timespec="seconds")
        d["invalidate_reason"] = "; ".join(changed)
        save(path, d)

    if changed:
        print(f"✗ {d.get('card_id')} 已失效（status=invalidated）")
        for c in changed:
            print(f"    - {c}")
        print("    → 被核对象已改动，旧结论不得再引用；须对新版本重新出卡复核。")
        return False

    print(f"✓ {d.get('card_id')} 绑定有效（status={d.get('status')}）")
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--set-status", dest="set_status",
                    choices=["pending", "running", "done", "invalidated"])
    ap.add_argument("--case")
    ap.add_argument("--card")
    ap.add_argument("--all", action="store_true", help="--list 时显示所有状态")
    ap.add_argument("--root", default=str(Path.home() / "Documents" / "My Legal-agents"))
    a = ap.parse_args()

    if a.list:
        if not a.case:
            print("[错误] --list 需要 --case", file=sys.stderr)
            sys.exit(3)
        case_dir = os.path.join(a.root, a.case)
        if not os.path.isdir(case_dir):
            print(f"[错误] 案件目录不存在：{case_dir}", file=sys.stderr)
            sys.exit(3)
        sys.exit(cmd_list(case_dir, a.all))

    if a.verify:
        targets = []
        if a.card:
            if not os.path.exists(a.card):
                print(f"[错误] 卡片不存在：{a.card}", file=sys.stderr)
                sys.exit(3)
            targets = [a.card]
        elif a.case:
            targets = find_cards(os.path.join(a.root, a.case))
            if not targets:
                print("（无复核卡）")
                sys.exit(0)
        else:
            print("[错误] --verify 需要 --card 或 --case", file=sys.stderr)
            sys.exit(3)
        ok = all(verify_one(p) for p in targets)
        sys.exit(0 if ok else 1)

    if a.set_status:
        if not a.card:
            print("[错误] --set-status 需要 --card", file=sys.stderr)
            sys.exit(3)
        d = load(a.card)
        d["status"] = a.set_status
        d[f"{a.set_status}_at"] = datetime.now().isoformat(timespec="seconds")
        save(a.card, d)
        print(f"✓ {d.get('card_id')} status → {a.set_status}")
        sys.exit(0)

    ap.print_help()
    sys.exit(3)


if __name__ == "__main__":
    main()
