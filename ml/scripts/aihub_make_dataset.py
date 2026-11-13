"""pool/에 쌓인 사진 전부로 YOLO 데이터셋을 만든다. 학습하기 직전에 매번 새로 만든다.

- 클래스는 configs/classes.yaml의 규칙으로 정한다.
- 학습/검증은 **상품 단위로** 나눈다. 같은 상품의 다른 각도 사진이 양쪽에 섞이면
  검증 점수가 '처음 보는 상품'이 아니라 '본 상품'을 맞히는 점수가 되기 때문이다.
  (AI Hub의 Validation도 Training과 같은 상품이라 그대로 쓰지 않는다.)

결과 (out/)
  images/{train,val}/*.jpg, labels/{train,val}/*.txt   YOLO 형식
  data.yaml       학습할 때 data= 로 넘기는 파일
  split.csv       상품마다 어느 쪽에 들어갔는지 기록

사용법 (fridge/ml 에서):
  uv run python -I scripts/aihub_make_dataset.py datasets/aihub-product/pool datasets/dairy-v1 [--overwrite]
"""

import argparse
import csv
import random
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import yaml

ML_DIR = Path(__file__).resolve().parent.parent


def load_classes(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)["classes"]


def class_of(row: dict, classes: list[dict]) -> int | None:
    for i, c in enumerate(classes):
        if all(row.get(k) == v for k, v in c["match"].items()):
            return i
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pool", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--classes", type=Path, default=ML_DIR / "configs" / "classes.yaml")
    ap.add_argument("--val-ratio", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--overwrite", action="store_true", help="out에 이전에 만든 데이터셋이 있으면 지우고 다시 만든다")
    args = ap.parse_args()

    if args.out.exists() and any(args.out.iterdir()):
        if not (args.overwrite and (args.out / "data.yaml").exists()):
            sys.exit(f"{args.out} 가 비어 있지 않습니다. 이 스크립트로 만든 폴더면 --overwrite를 붙이세요.")
        shutil.rmtree(args.out)

    classes = load_classes(args.classes)
    names = [c["name"] for c in classes]

    # 이미지 → 상품, 상품 → 클래스
    images_of: dict[str, list[str]] = defaultdict(list)
    product: dict[str, dict] = {}
    for manifest in sorted((args.pool / "manifests").glob("*.csv")):
        with manifest.open(encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                images_of[row["item_no"]].append(row["image"])
                product.setdefault(row["item_no"], row)

    items_of_class: dict[int, list[str]] = defaultdict(list)
    dropped = 0
    for item, row in product.items():
        cls = class_of(row, classes)
        if cls is None:
            dropped += 1
        else:
            items_of_class[cls].append(item)

    # 클래스마다 상품을 섞어서 일부를 검증용으로 뗀다 (seed 고정 → 다시 만들어도 같은 결과)
    rng = random.Random(args.seed)
    split_of: dict[str, str] = {}
    for cls, items in items_of_class.items():
        items = sorted(items)
        rng.shuffle(items)
        n_val = max(1, round(len(items) * args.val_ratio)) if len(items) >= 2 else 0
        for i, item in enumerate(items):
            split_of[item] = "val" if i < n_val else "train"

    for split in ("train", "val"):
        (args.out / "images" / split).mkdir(parents=True, exist_ok=True)
        (args.out / "labels" / split).mkdir(parents=True, exist_ok=True)

    counts = defaultdict(lambda: [0, 0, 0, 0])  # 클래스별 [상품 train, 상품 val, 사진 train, 사진 val]
    with (args.out / "split.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["item_no", "class", "split", "img_prod_nm", "n_images"])
        for cls, items in sorted(items_of_class.items()):
            for item in sorted(items):
                split = split_of[item]
                c = counts[cls]
                c[0 if split == "train" else 1] += 1
                for image in images_of[item]:
                    shutil.copy2(args.pool / "images" / f"{image}.jpg", args.out / "images" / split / f"{image}.jpg")
                    boxes = (args.pool / "boxes" / f"{image}.txt").read_text(encoding="utf-8").split()
                    lines = [f"{cls} {' '.join(boxes[i:i + 4])}" for i in range(0, len(boxes), 4)]
                    (args.out / "labels" / split / f"{image}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
                    c[2 if split == "train" else 3] += 1
                writer.writerow([item, names[cls], split, product[item]["img_prod_nm"], len(images_of[item])])

    data = {
        "path": str(args.out.resolve()).replace("\\", "/"),
        "train": "images/train",
        "val": "images/val",
        "names": dict(enumerate(names)),
    }
    with (args.out / "data.yaml").open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)

    print(f"{'class':<10}{'상품 train':>10}{'상품 val':>10}{'사진 train':>12}{'사진 val':>10}")
    for cls in sorted(counts):
        pt, pv, it, iv = counts[cls]
        print(f"{names[cls]:<10}{pt:>10}{pv:>10}{it:>12}{iv:>10}")
    print(f"클래스 규칙에 안 맞아 뺀 상품: {dropped}개")
    print(f"저장: {args.out / 'data.yaml'}")


if __name__ == "__main__":
    main()
