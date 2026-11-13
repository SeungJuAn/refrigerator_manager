"""AI Hub '상품 이미지' zip 한 쌍([라벨] + [원천])을 줄여서 pool/에 쌓는다.

묶음을 하나 받을 때마다 한 번 돌리고, 끝나면 원본 zip은 지워도 된다.
클래스 번호는 여기서 정하지 않는다 — 학습 직전에 aihub_make_dataset.py가 정한다.

결과 (pool/)
  images/{이미지}.jpg          긴 변 640px로 줄인 사진
  boxes/{이미지}.txt           한 줄에 박스 하나: "xc yc w h" (0~1 비율, YOLO와 같은 순서)
  manifests/{split}_{카테고리}.csv   이미지 한 장당 한 줄: 상품번호·분류(div_l/m/s)·상품명

사용법 (fridge/ml 에서):
  uv run python -I scripts/aihub_shrink.py <라벨 zip> <원천 zip> datasets/aihub-product/pool [--per-product 18]
"""

import argparse
import csv
import io
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image

STEM_RE = re.compile(r"^(?P<item>\d+)_(?P<height>\d+)_(?P<kind>[sm])_(?P<idx>\d+)$")
META_FIELDS = ["div_l", "div_m", "div_s", "div_n", "img_prod_nm", "volume"]
TARGET = 640


def stem_of(zip_name: str) -> str:
    return zip_name.rsplit("/", 1)[-1].rsplit(".", 1)[0]


def read_labels(label_zip: Path) -> tuple[dict, dict]:
    """이미지 stem → VOC xml 정보, 상품번호 → meta 정보"""
    voc: dict[str, zipfile.ZipInfo] = {}
    meta_info: dict[str, zipfile.ZipInfo] = {}
    with zipfile.ZipFile(label_zip, metadata_encoding="cp949") as z:
        for info in z.infolist():
            if info.is_dir() or not info.filename.endswith(".xml"):
                continue
            stem = stem_of(info.filename)
            if stem.endswith("_meta"):
                item = stem.split("_", 1)[0]
                meta_info.setdefault(item, info)
            elif STEM_RE.match(stem):
                voc[stem] = info

        boxes: dict[str, tuple[int, int, list]] = {}
        for stem, info in voc.items():
            root = ET.fromstring(z.read(info))
            w = int(root.findtext("size/width"))
            h = int(root.findtext("size/height"))
            objs = []
            for o in root.iter("object"):
                b = o.find("bndbox")
                objs.append(tuple(float(b.findtext(k)) for k in ("xmin", "ymin", "xmax", "ymax")))
            boxes[stem] = (w, h, objs)

        products: dict[str, dict] = {}
        for item, info in meta_info.items():
            root = ET.fromstring(z.read(info))
            products[item] = {f: (root.findtext(f".//{f}") or "").strip() for f in META_FIELDS}
    return boxes, products


def pick_evenly(stems: list[str], n: int) -> list[str]:
    """높이·종류·번호 순으로 정렬한 뒤 고르게 n장 고른다 (각도가 한쪽으로 몰리지 않게)."""
    def key(s: str):
        m = STEM_RE.match(s)
        return (int(m["height"]), m["kind"], int(m["idx"]))

    stems = sorted(stems, key=key)
    if n <= 0 or len(stems) <= n:
        return stems
    step = len(stems) / n
    return [stems[int(i * step)] for i in range(n)]


def to_yolo(w: int, h: int, objs: list) -> list[str]:
    lines = []
    for xmin, ymin, xmax, ymax in objs:
        xmin, xmax = max(0.0, xmin), min(float(w), xmax)
        ymin, ymax = max(0.0, ymin), min(float(h), ymax)
        if xmax <= xmin or ymax <= ymin:
            continue
        xc, yc = (xmin + xmax) / 2 / w, (ymin + ymax) / 2 / h
        bw, bh = (xmax - xmin) / w, (ymax - ymin) / h
        lines.append(f"{xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}")
    return lines


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("label_zip", type=Path)
    ap.add_argument("source_zip", type=Path)
    ap.add_argument("pool", type=Path)
    ap.add_argument("--per-product", type=int, default=18, help="상품당 남길 사진 수 (0 = 전부)")
    args = ap.parse_args()

    split = "val" if "validation" in {p.lower() for p in args.source_zip.parts} else "train"
    category = re.sub(r"\d+$", "", args.source_zip.stem.replace("[원천]", ""))
    tag = f"{split}_{category}"

    boxes, products = read_labels(args.label_zip)
    print(f"[{tag}] 라벨: 사진 {len(boxes)}장, 상품 {len(products)}개", flush=True)

    (args.pool / "images").mkdir(parents=True, exist_ok=True)
    (args.pool / "boxes").mkdir(parents=True, exist_ok=True)
    (args.pool / "manifests").mkdir(parents=True, exist_ok=True)

    skipped = defaultdict(int)
    rows = []
    with zipfile.ZipFile(args.source_zip, metadata_encoding="cp949") as z:
        by_item: dict[str, dict[str, zipfile.ZipInfo]] = defaultdict(dict)
        for info in z.infolist():
            if info.is_dir() or not info.filename.lower().endswith(".jpg"):
                continue
            stem = stem_of(info.filename)
            if not STEM_RE.match(stem):
                skipped["이름 형식 다름"] += 1
            elif stem not in boxes:
                skipped["라벨 없음"] += 1
            else:
                by_item[stem.split("_", 1)[0]][stem] = info

        for n, (item, infos) in enumerate(sorted(by_item.items()), 1):
            meta = products.get(item)
            if meta is None:
                skipped["상품 정보 없음"] += len(infos)
                continue
            for stem in pick_evenly(list(infos), args.per_product):
                w, h, objs = boxes[stem]
                try:
                    im = Image.open(io.BytesIO(z.read(infos[stem])))
                    im.load()
                except Exception:
                    skipped["사진 깨짐"] += 1
                    continue
                if im.size != (w, h):
                    skipped["라벨과 사진 크기 다름"] += 1
                    continue
                lines = to_yolo(w, h, objs)
                if not lines:
                    skipped["박스 없음"] += 1
                    continue
                im = im.convert("RGB")
                im.thumbnail((TARGET, TARGET), Image.Resampling.LANCZOS)
                im.save(args.pool / "images" / f"{stem}.jpg", quality=90)  # EXIF는 버린다
                (args.pool / "boxes" / f"{stem}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
                rows.append({"image": stem, "item_no": item, "split_src": split, "category": category,
                             "n_boxes": len(lines), **meta})
            if n % 50 == 0:
                print(f"  상품 {n}/{len(by_item)}", flush=True)

    manifest = args.pool / "manifests" / f"{tag}.csv"
    with manifest.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"[{tag}] 저장: 사진 {len(rows)}장, 상품 {len({r['item_no'] for r in rows})}개 → {manifest}")
    for reason, count in skipped.items():
        print(f"  건너뜀 ({reason}): {count}")  # Windows 콘솔(cp949)에 없는 문자(— 등)는 쓰지 않는다


if __name__ == "__main__":
    sys.exit(main())
