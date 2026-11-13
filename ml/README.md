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

- 상품 이미지 — 포장 상품 9,711종, 바운딩박스(VOC XML). 라벨 zip으로 확인한 내용:
  - 상품당 학습용 약 114장 + 검증용 15장, 카메라 높이 3단계(0°/30°/60°), 원본 2988×2988
  - 한 개만 찍은 사진(`s`)과 **같은 상품** 여러 개를 찍은 사진(`m`)이 반반. 다른 상품이 섞인 장면은 없다
  - `_meta.xml`에 분류(대·중·소)가 있어서 상품 → 재료 이름 매핑을 손으로 안 해도 된다 (예: 유제품 > 우유 > 일반우유)
  - 검증용 상품이 학습용과 같은 상품이라, 처음 보는 상품에 대한 성능을 재려면 **상품 단위로** 다시 나눠야 한다
  - 냉장고에 맞는 건 유제품(우유·요구르트·치즈·버터)과 소스의 장류·마요네즈·케첩 정도
- 농산물 품질(QC) 이미지 — 무·배추·양파·마늘·양배추·감·사과·배·감귤·감자. 한 장에 하나씩 촬영
- 빠진 품목(대파·두부·계란·고기·반찬통)은 직접 찍어서 채운다

### 실제 환경 사진 후보 (2026-11-13 조사)

| 데이터 | 사진 | 쓸 만한 클래스 | 라이선스 | 용도 |
|---|---|---|---|---|
| [Roboflow — Fridge Detection](https://universe.roboflow.com/james-elcock/fridge-detection-ojugs) | 3,268장, 실제 냉장고 안 여러 물건 | milk, natural_yoghurt, cheese, cream_cheese, butter, egg, ham, sausages, soy_sauce, tomato_ketchup, spring_onions 등 77개 | CC BY-NC-SA 4.0 (비상업) | 테스트용. 같은 냉장고를 반복 촬영, 증강 사진 섞임, 클래스가 지저분하다(egg/eggs, `]`, `#`) |
| [Roboflow — ingredients_detection](https://universe.roboflow.com/smartpantry/ingredients_detection-shwnt) | 8,514장, 휴대폰 사진·요리 영상 캡처·웹 이미지 | bean_curd(두부), green_onion(대파), egg, cheese, butter, garlic, cabbage, radish, pork, beef, chicken, bok_choy 등 44개 (우유 없음) | CC BY 4.0 | 빠진 품목 학습용 |
| [AI Hub — 객체 인식용 한국형 비전 데이터](https://www.aihub.or.kr/aihubdata/data/view.do?currMenu=115&topMenu=100&dataSetSn=71452) | 약 300만 장, 촬영 환경 미기재 | 쪽파, 양파, 마늘, 감자, 무, 양배추, 상추, 깻잎, 고추, 애호박, 김치 등 | 내국인·승인 | 한국 채소 학습용 |
| Open Images V7 | 실제 사진(Flickr) | Milk, Cheese, Egg, 채소 다수 (Yogurt·Butter·Tofu 없음) | 라벨 CC BY 4.0 | 보조. Milk는 컵에 따른 우유도 포함 |

제외: AI Hub "건강관리를 위한 음식 이미지"(IRB 심의 + 안심존에서만 열람), "음식 이미지 및 영양정보"(요리 단위)

### 상품 목록 만들기

라벨 zip은 풀지 않고 바로 읽는다 (zip 안 파일 이름은 cp949, XML 내용은 UTF-8).

```bash
uv run python -I scripts/aihub_catalog.py "<라벨 zip 폴더>" datasets/aihub-product/catalog.csv
```

### 받기 → 줄이기 → 데이터셋 → 학습

전체(724GB)는 디스크에 안 들어가서, **받기·줄이기는 묶음마다 나눠서** 하고 **학습은 쌓인 것 전부로 매번 처음부터** 한다.
이전 학습 결과(`best.pt`)에 새 묶음만 이어서 학습하면 앞에서 배운 클래스를 잊어버린다.

```bash
# 1) 묶음 하나 줄여서 쌓기 — 긴 변 640px, 상품당 최대 18장 (각도 고르게). 끝나면 원본 zip은 지워도 된다
uv run python -I scripts/aihub_shrink.py "<[라벨] zip>" "<[원천] zip>" datasets/aihub-product/pool

# 2) 쌓인 것 전부로 데이터셋 만들기 — 클래스는 configs/classes.yaml, 학습/검증은 상품 단위로 8:2
uv run python -I scripts/aihub_make_dataset.py datasets/aihub-product/pool datasets/dairy-v1 --overwrite

# 3) 학습 — 항상 yolo11n.pt(COCO 사전학습)에서 시작
uv run yolo train model=yolo11n.pt data=datasets/dairy-v1/data.yaml epochs=50 imgsz=640 batch=32 device=0 workers=0 cache=ram seed=0
```

- `-I`(격리 모드)는 받은 데이터 폴더의 파일이 파이썬 모듈로 잘못 불려 오지 않게 하려는 것
- 줄이기 실측: Validation 유제품 2.6GB → 238MB (4,264장, 1장은 원본이 잘려 있어서 제외). 4분 걸림
- AI Hub 사진은 흰 회전판 위 스튜디오 사진이다. 실제 냉장고·식탁 사진과 달라서, 최종 평가는 직접 찍은 사진으로 따로 한다

## 실험 기록

### dairy-v1-rehearsal (2026-11-13)

파이프라인 리허설. Validation 유제품만, yolo11n, 50 epoch, 29분 (RTX 5070 Ti).

| class | 검증 상품 | P | R | mAP50 | mAP50-95 |
|---|---|---|---|---|---|
| 전체 | 56 | 0.78 | 0.71 | 0.77 | 0.74 |
| milk | 19 | 0.89 | 0.73 | 0.77 | 0.76 |
| yogurt | 27 | 0.74 | 0.92 | 0.87 | 0.85 |
| cheese | 8 | 0.65 | 0.78 | 0.82 | 0.79 |
| butter | 2 | 0.85 | 0.41 | 0.60 | 0.58 |

- **위치는 거의 다 맞히고, 틀리는 건 종류다.** 물체를 아예 놓친 비율은 milk 1%뿐이고, mAP50과 mAP50-95가 거의 같다(박스가 정확하다)
- 헷갈림: milk → yogurt 27%(마시는 요구르트가 우유처럼 생겼다), butter → cheese 52%(둘 다 작은 네모 덩어리, 버터 학습 상품은 9개뿐), cheese → yogurt 24%
- 31 epoch 이후 학습 loss는 계속 내려가는데 검증 loss는 다시 오른다 → 과적합 시작. best.pt는 41 epoch
- 검증 상품이 56개뿐이라 epoch마다 mAP가 0.68~0.77로 크게 흔들린다. 숫자 하나하나에 의미를 두기 어렵다
- 이미지 처리 속도가 초당 약 100장, GPU 추론은 장당 0.7ms → 데이터 로딩(`workers=0`)이 병목으로 보인다. 다음엔 `workers`를 올려서 확인
- **Training 유제품을 받아도 상품 종류는 늘지 않는다.** Training과 Validation은 같은 285종이고 각도만 다르다. 처음 보는 상품을 알아보는 힘은 상품 종류 수에 달려 있다

`datasets/`, `runs/`, `weights/`는 git에 올리지 않는다.
