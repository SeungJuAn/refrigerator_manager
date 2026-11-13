# ml — 식재료 객체탐지 실험 (YOLO)

v1 앱은 비전 LLM으로 재료를 인식한다. 이 폴더는 v2 실험용으로,
직접 학습한 객체탐지 모델(YOLO)을 LLM과 정확도·비용·속도로 비교하는 게 목표다.

## 환경

- Python 3.12, [uv](https://docs.astral.sh/uv/)로 관리
- PyTorch 2.14 (CUDA 13.0 빌드) — RTX 50 시리즈는 CUDA 12.8 이상 빌드가 필요하다
- Ultralytics 8.4 (YOLO)
- 확인된 학습 기기: RTX 5070 Ti 16GB

## 설치

```bash
cd ml
uv sync
```

## 동작 확인

```bash
uv run python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
uv run yolo train model=yolo11n.pt data=coco8.yaml epochs=3 imgsz=640 device=0 workers=0
```

Windows에서는 `workers=0`으로 둔다 (데이터 로더 멀티프로세싱 문제 회피).

## 데이터 후보 (AI Hub, 내국인 신청·승인 필요, 재배포 금지)

- 상품 이미지 — 포장 식품, 바운딩박스, 여러 상품이 섞인 장면 포함. 라벨이 상품 코드라 재료 이름 매핑이 필요하다
- 농산물 품질(QC) 이미지 — 무·배추·양파·마늘·양배추·감·사과·배·감귤·감자. 한 장에 하나씩 촬영
- 빠진 품목(대파·두부·계란·고기·반찬통)은 직접 찍어서 채운다

`datasets/`, `runs/`, `weights/`는 git에 올리지 않는다.
