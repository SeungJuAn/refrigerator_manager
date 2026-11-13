# fridge — 냉장고 식재료 재고·요리 추천 앱

장 봐온 재료를 **사진으로 찍으면** AI가 재료 목록을 만들고,
**곧 상하는 재료로 할 수 있는 요리**를 추천해 주는 앱.

## 구조

| 폴더 | 내용 |
|---|---|
| `app/` | 아이폰 앱 — React Native + Expo (TypeScript) |
| `server/` | API 서버 — NestJS (TypeScript strict) |
| `ml/` | 식재료 객체탐지 실험 — YOLO (v2용, [ml/README.md](ml/README.md)) |

## 실행

### 앱

```bash
cd app
npm install
npx expo start
```

아이폰에 **Expo Go**(앱스토어 무료)를 깔고, 터미널에 뜬 QR 코드를 아이폰 카메라로 찍는다.
PC와 아이폰이 같은 Wi-Fi에 있어야 한다.

### 서버

```bash
cd server
npm install
cp .env.example .env   # GEMINI_API_KEY 채우기 (Google AI Studio에서 발급)
npm run start:dev
```

`http://localhost:3000`에서 뜬다. 키가 없어도 서버는 뜨고, 사진 인식만 503으로 실패한다.

### API

**`POST /recognition`** — 사진 한 장에서 식품 목록을 뽑는다 (저장은 안 함)

- 요청: `multipart/form-data`, 필드 `photo` (JPEG·PNG·WebP·HEIC, 10MB 이하)
- 응답 `200`:

```json
{
  "items": [
    {
      "name": "우유",
      "productName": "서울우유 1L",
      "quantity": 2,
      "unit": "팩",
      "storage": "fridge",
      "expiryDate": "2026-11-20",
      "shelfLifeDays": 10,
      "confidence": "high"
    }
  ]
}
```

- `expiryDate`는 포장에 찍힌 날짜를 읽었을 때만 있고, 없으면 `null` → 앱이 `오늘 + shelfLifeDays`를 기본값으로 제안한다
- 오류: `400` 사진 없음·이미지 아님, `413` 10MB 초과, `502` 모델 답이 형식에 안 맞음, `503` Gemini 호출 실패(키 없음·한도 초과 등)

```bash
curl -F "photo=@groceries.jpg" http://localhost:3000/recognition
```

## v1 범위

**넣을 것**
1. 사진으로 재료 등록 — AI(Gemini API)가 이름·수량을 추정하고, 사용자가 확인·수정한 뒤 저장
2. 재고 목록 — 보관 위치(냉장/냉동/실온), 유통기한
3. "다 썼어요" 버튼
4. 요리 추천 — 유통기한이 가까운 재료 우선
5. 유통기한 알림 — 2일 전, 폰 안에서 예약하는 로컬 알림

**뺄 것**: 냉장고 전체 사진 인식, 가족 공유, 영수증 인식, 레시피 DB 구축, 스토어 출시

## AI 페어프로그래밍

이 프로젝트는 Claude Code와 페어프로그래밍으로 만든다.
무엇을 직접 판단했고 어떻게 검수했는지를 여기에 남긴다.

- **초기 세팅** (2026-11-12): 스캐폴딩(Expo `blank-typescript`, NestJS `--strict`)과 이 README는 Claude Code가 생성.
  - 직접 판단: 모바일 웹 대신 앱으로 간다(유통기한 알림·카메라가 핵심), 알림은 v1에서 로컬 알림으로, 냉장고 전체 인식 대신 넣을 때 찍기.
  - 검수: 앱 타입체크, 서버 빌드·단위 테스트·e2e 테스트 통과 확인.
- **ML 환경** (2026-11-13): uv 프로젝트, PyTorch(CUDA 13.0 빌드), Ultralytics 설치는 Claude Code가 진행.
  - 직접 판단: 객체탐지는 v1이 아니라 v2 실험으로, 데이터는 AI Hub + 직접 촬영으로 채운다.
  - 검수: GPU 인식 확인, 샘플 데이터(coco8)로 3 epoch 학습 통과.
- **AI Hub 데이터 → 첫 학습** (2026-11-13): 상품 목록·줄이기·데이터셋 스크립트(`ml/scripts/`)는 Claude Code가 작성.
  - 직접 판단: 전체(724GB) 대신 라벨만 먼저 받고, 사진은 필요한 묶음만 받아서 줄여 쌓은 뒤 한 번에 학습한다. 첫 학습은 작은 묶음(Validation 유제품)으로 리허설.
  - 검수: 샘플 XML을 직접 열어 형식 확인 후 README의 틀린 데이터 설명을 고침, 변환한 박스를 사진 위에 그려 위치 확인, 학습/검증을 상품 단위로 나눠 같은 상품이 양쪽에 섞이지 않게 함. 결과는 [ml/README.md](ml/README.md#실험-기록).
- **인식 방식 결정** (2026-11-13)
  - 직접 판단: v1 앱은 Gemini API 무료 등급으로 인식하고, 앱을 먼저 완성한다. 직접 학습한 YOLO는 v2에서 Gemini와 비교하는 실험으로 미룬다.
  - 근거: Cloud Vision API는 영어 일반 태그("Bottle", "Dairy")만 줘서 재료 구분이 안 되고, Gemini는 포장지 한글을 읽는다. 가격·무료 등급 조건은 공식 가격 페이지에서 확인.
- **사진 인식 API** (2026-11-13): `server/src/recognition/`과 테스트는 Claude Code가 작성. NestJS 공식 `@nestjs/ai` + `@ai-sdk/google` 사용.
  - 설계: 모델 답은 Zod 스키마로 받되 숫자·날짜 제약은 느슨하게 두고 서버에서 정리한다(조금만 어긋나도 답 전체가 거부되지 않게). 유통기한은 포장에서 읽은 것만 받고, 없으면 보관 일수로 앱이 제안한다.
  - 검수: 빌드·oxlint·Prettier 통과, 단위 17개(가짜 모델로 정상·정리·502·503, 날짜 변환) + e2e 5개(업로드 정상·사진 없음·이미지 아님·10MB 초과) 통과, 키 없이 실제 경로를 호출해 503이 나는 것 확인. **실제 Gemini 호출은 키 발급 후 아직 확인 전.**

## 다음에 할 일

- [ ] Gemini API 키 발급 (Google AI Studio) → `server/.env`에만 둔다
- [ ] 실제 장 본 사진으로 `POST /recognition` 확인: 한글 상품명·유통기한을 얼마나 읽는지, 응답 시간
- [x] 서버: 사진을 받아 Gemini로 재료 목록(JSON)을 돌려주는 API
- [ ] 재고 데이터 모델 정하기 (이름, 수량, 보관 위치, 유통기한)
- [ ] 아이폰 Expo Go로 첫 화면 띄우기 (맥북)
- [ ] (ml, v2) 실제 냉장고 사진 데이터로 리허설 모델 테스트, 클래스 정하기
