"""AI Hub '상품 이미지' 라벨 zip들을 압축을 풀지 않고 읽어서 상품 목록(catalog.csv)을 만든다.

라벨 zip 안 구조 (확인: 2026-11-13)
  {상품번호}_{상품명}/{상품번호}_{높이}_{s|m}_{번호}.xml       ← VOC 형식 bbox
  {상품번호}_{상품명}/{상품번호}_{높이}_{s|m}_{번호}_meta.xml  ← 분류·상품명·용량·바코드 + bbox
  - zip 안 파일 이름은 cp949, XML 내용은 UTF-8
  - s = 한 개만 찍은 사진, m = 여러 개 찍은 사진

사용법 (fridge/ml 에서):
  uv run python -I scripts/aihub_catalog.py "<라벨 zip들이 있는 폴더>" datasets/aihub-product/catalog.csv
"""

import csv
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

LABEL_RE = re.compile(r"^(?P<item>\d+)_(?P<height>\d+)_(?P<kind>[sm])_(?P<idx>\d+)\.xml$")
META_FIELDS = ["div_l", "div_m", "div_s", "div_n", "comp_nm", "img_prod_nm", "volume", "barcd"]


def split_from_path(zip_path: Path) -> str:
    parts = {p.lower() for p in zip_path.parts}
    if "training" in parts:
        return "train"
    if "validation" in parts:
        return "val"
    return "?"


def category_from_zip(zip_path: Path) -> str:
    # "[라벨]음료1.zip" → "음료"
    name = zip_path.stem.replace("[라벨]", "")
    return re.sub(r"\d+$", "", name)


def read_meta(z: zipfile.ZipFile, info: zipfile.ZipInfo) -> dict[str, str]:
    root = ET.fromstring(z.read(info))
    return {f: (root.findtext(f".//{f}") or "").strip() for f in META_FIELDS}


def object_names(z: zipfile.ZipFile, info: zipfile.ZipInfo) -> list[str]:
    root = ET.fromstring(z.read(info))
    return [(o.findtext("name") or "").strip() for o in root.iter("object")]


def scan_zip(zip_path: Path) -> list[dict]:
    split = split_from_path(zip_path)
    category = category_from_zip(zip_path)
    products: dict[str, dict] = {}
    images: dict[str, Counter] = defaultdict(Counter)
    heights: dict[str, set] = defaultdict(set)
    first_meta: dict[str, zipfile.ZipInfo] = {}
    first_multi: dict[str, zipfile.ZipInfo] = {}

    with zipfile.ZipFile(zip_path, metadata_encoding="cp949") as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            fname = info.filename.rsplit("/", 1)[-1]
            if fname.endswith("_meta.xml"):
                item = fname.split("_", 1)[0]
                first_meta.setdefault(item, info)
                continue
            m = LABEL_RE.match(fname)
            if not m:
                continue
            item = m["item"]
            images[item][m["kind"]] += 1
            heights[item].add(m["height"])
            if m["kind"] == "m":
                first_multi.setdefault(item, info)

        for item, counts in images.items():
            meta = read_meta(z, first_meta[item]) if item in first_meta else {}
            mixed = ""
            if item in first_multi:
                names = object_names(z, first_multi[item])
                mixed = "Y" if len(set(names)) > 1 else "N"
            products[item] = {
                "split": split,
                "zip": zip_path.name,
                "category": category,
                "item_no": item,
                **{f: meta.get(f, "") for f in META_FIELDS},
                "images_single": counts["s"],
                "images_multi": counts["m"],
                "heights": "/".join(sorted(heights[item])),
                "multi_has_other_products": mixed,
            }
    return list(products.values())


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])
    zips = sorted(src.rglob("*.zip"))
    if not zips:
        sys.exit(f"zip 파일이 없습니다: {src}")

    rows: list[dict] = []
    for zp in zips:
        found = scan_zip(zp)
        rows.extend(found)
        print(f"{zp.parent.name}/{zp.name}: 상품 {len(found)}개", flush=True)

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8-sig") as f:  # BOM: 엑셀에서 한글이 안 깨지게
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"저장: {out} ({len(rows)}행)")


if __name__ == "__main__":
    main()
