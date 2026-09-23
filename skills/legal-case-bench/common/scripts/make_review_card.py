#!/usr/bin/env python3
"""生成复核卡（card.md + request.json），并对材料定位执行路径白名单。

反锚的核心执行点：
  A 类法律观点复核的复核卡只允许出现「原件路径」与「10-中间转换/ 溯源件」；
  一旦混入 20-过程稿/、02-定稿/、00-案件笔记.md 等含主脑结论的路径，直接报错退出。
  这样「别把结论稿混进复核卡」就从一句提示词约束，变成脚本级硬拦截。

用法:
  python3 make_review_card.py --case "<案件名>" --task "<任务名>" \
      --type A --proposition "<待证命题>" \
      --materials "<路径1>,<路径2>" [--target "<被核稿路径>"] [--root "<产物根>"]

退出码:
  0 成功
  2 路径白名单拦截（A 类混入结论稿路径）
  3 参数或路径错误
"""
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime

# 含主脑结论的产物区域：复核卡中一旦出现即视为泄底
FORBIDDEN_MARKERS = [
    "20-过程稿",
    "02-定稿",
    "00-案件笔记.md",
    "30-复核",
    "_case_state.json",
]
# 允许出现的溯源区域
ALLOWED_MARKERS = ["10-中间转换"]


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def check_whitelist(path: str) -> tuple:
    """返回 (是否放行, 命中原因)。放行条件：不在 FORBIDDEN 中。"""
    norm = path.replace("\\", "/")
    for marker in FORBIDDEN_MARKERS:
        if marker in norm:
            return False, f"命中禁用区「{marker}」"
    return True, ""


def abort_on_leak(paths, label: str) -> None:
    bad = []
    for p in paths:
        ok, reason = check_whitelist(p)
        if not ok:
            bad.append(f"    - {p}\n      {reason}")
    if bad:
        print("=" * 68, file=sys.stderr)
        print("[反锚拦截] 复核卡材料定位中出现含主脑结论的路径：", file=sys.stderr)
        print("\n".join(bad), file=sys.stderr)
        print("", file=sys.stderr)
        print("复核卡只应包含：原件路径 与 10-中间转换/ 溯源件。", file=sys.stderr)
        print("请把结论稿、过程稿、案件笔记从材料定位中移除后重试。", file=sys.stderr)
        print("=" * 68, file=sys.stderr)
        sys.exit(2)


def next_card_id(review_dir: str, rtype: str) -> str:
    os.makedirs(review_dir, exist_ok=True)
    used = {f.split(".")[0] for f in os.listdir(review_dir) if f.endswith(".request.json")}
    seq = 1
    while True:
        cid = f"{datetime.now().strftime('%Y%m%d')}-{seq:03d}-{rtype}"
        if cid not in used:
            return cid
        seq += 1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", required=True, help="案件名（产物区子目录名）")
    ap.add_argument("--task", required=True, help="任务名（01-过程稿 下的子目录名）")
    ap.add_argument("--type", required=True, choices=["A", "B"], help="A=法律观点对抗复核 / B=事实OCR抽核")
    ap.add_argument("--proposition", required=True, help="待证命题（A 类须为可证伪的命题句）")
    ap.add_argument("--materials", default="", help="材料定位路径，逗号分隔")
    ap.add_argument("--target", default="", help="被核对象路径（可选）")
    ap.add_argument(
        "--root",
        default=os.path.join(os.path.expanduser("~"), "Documents", "My Legal-agents"),
        help="产物根",
    )
    ap.add_argument("--fields", default="", help="B 类：待核对字段清单，逗号分隔")
    a = ap.parse_args()

    case_dir = os.path.join(a.root, a.case)
    if not os.path.isdir(case_dir):
        print(f"[错误] 案件目录不存在：{case_dir}", file=sys.stderr)
        sys.exit(3)

    review_dir = os.path.join(case_dir, "01-过程稿", a.task, "30-复核")
    os.makedirs(review_dir, exist_ok=True)

    materials = [p.strip() for p in a.materials.split(",") if p.strip()]
    if not materials and not a.target:
        print("[错误] --materials 与 --target 至少提供一个", file=sys.stderr)
        sys.exit(3)

    # ---- 反锚拦截：材料定位一律不得含结论区域 ----
    abort_on_leak(materials, "材料定位")
    # A 类连被核对象也不得是过程稿/定稿（A 类只核命题，不核稿件）
    if a.type == "A" and a.target:
        abort_on_leak([a.target], "被核对象")

    missing = [p for p in materials + ([a.target] if a.target else []) if not os.path.exists(p)]
    if missing:
        print("[错误] 以下路径不存在：", file=sys.stderr)
        for p in missing:
            print(f"    - {p}", file=sys.stderr)
        sys.exit(3)

    card_id = next_card_id(review_dir, a.type)

    def entry(p):
        e = {"path": p}
        try:
            e["sha256"] = sha256_of(p)
        except Exception as exc:
            e["sha256"] = None
            e["hash_error"] = str(exc)
        return e

    target_entry = entry(a.target) if a.target else None
    material_entries = [entry(p) for p in materials]

    req = {
        "card_id": card_id,
        "case": a.case,
        "task": a.task,
        "type": a.type,
        "status": "pending",
        "proposition": a.proposition,
        "target": target_entry,
        "materials": material_entries,
        "fields": [f.strip() for f in a.fields.split(",") if f.strip()],
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "product_dir": review_dir,
    }

    req_path = os.path.join(review_dir, f"{card_id}.request.json")
    with open(req_path, "w", encoding="utf-8") as f:
        json.dump(req, f, ensure_ascii=False, indent=2)

    # ---- card.md：给复核会话读的人读卡，内容严格限于命题 + 材料定位 ----
    lines = [
        f"# 复核卡 {card_id}",
        "",
        f"- 案件：{a.case}",
        f"- 任务：{a.task}",
        f"- 类型：{'A 类 · 法律观点对抗复核' if a.type == 'A' else 'B 类 · 事实/OCR 抽核'}",
        f"- 状态：pending",
        f"- 出卡时间：{req['created_at']}",
        "",
        "## 待证命题",
        "",
        a.proposition,
        "",
        "## 材料定位",
        "",
    ]
    if target_entry:
        lines.append(f"- 被核对象：`{target_entry['path']}`（sha256: `{target_entry['sha256']}`）")
    for m in material_entries:
        lines.append(f"- `{m['path']}`（sha256: `{m['sha256']}`）")
    if req["fields"]:
        lines += ["", "## 待核对字段", ""] + [f"- {f}" for f in req["fields"]]

    lines += [
        "",
        "## 复核要求",
        "",
    ]
    if a.type == "A":
        lines += [
            "**默认立场：该命题不成立。** 你的任务是努力证伪，不是确认。",
            "你没有拿到主脑的结论稿——这是设计如此，不是遗漏。",
            "",
            "按 7 类检查面逐项挑战，每条标 category + severity + 依据定位：",
            "反例 / 遗漏条款 / 定义问题 / 例外条款 / 交叉引用冲突 / 管辖法与法条适用 / 事实缺口。",
            "",
            "verdict 四值：upheld（须列出已检查角度）/ weakened / refuted / insufficient_evidence。",
        ]
    else:
        lines += [
            "按 OCR 四层法抽核：勾稽一致性 → 抽样对原图（**异引擎对拍**）→ 低置信区逐条 → 高风险数值整段对拍。",
            "低置信字段不擅自补录，标注「人工待核」；改稿另存新版本，不覆盖原稿。",
        ]
    lines += [
        "",
        "产出：同目录 `<card_id>.verdict.json` 与 `<card_id>.verdict.md`。",
        "",
        "> 若本卡内意外出现结论稿、推理链或我方定稿，属出卡违规，请立即停止并报告。",
    ]

    card_path = os.path.join(review_dir, f"{card_id}.card.md")
    with open(card_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).replace("<card_id>", card_id) + "\n")

    print(f"✓ 已生成复核卡 {card_id}")
    print(f"   卡片: {card_path}")
    print(f"   信封: {req_path}")
    print(f"   类型: {a.type}   材料: {len(material_entries)} 项")
    if a.type == "A":
        print("   反锚: A 类路径白名单已通过（无结论稿混入）")


if __name__ == "__main__":
    main()
