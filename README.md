# 택배허브 (delivery)

개인용 택배 통합 대시보드입니다.

## 현재 기능
- 운송장번호 저장 (브라우저 localStorage)
- 국내 주요 택배사 자동 추정(보수적 규칙)
- CJ대한통운 / 한진 / 롯데 / 로젠 / 우체국 / 경동 / 대신 / EMS 공식 조회 바로가기
- 배송중/완료 수동 상태 관리
- 문자·메일에서 숫자 운송장 및 EMS 형식 운송장 일괄 추출
- JSON 백업 내보내기
- 모바일 반응형 UI

## 중요한 제한
택배사들이 `휴대폰 번호 → 현재 배송 중인 모든 운송장`을 공개 API로 제공하지 않기 때문에, 전화번호만 입력해서 모든 택배를 자동 수집하는 기능은 현재 포함하지 않습니다.

## GitHub Pages
`.github/workflows/pages.yml`이 `main` 브랜치 변경 시 정적 사이트를 GitHub Pages로 배포합니다.

처음 한 번 저장소의 **Settings → Pages → Build and deployment → Source → GitHub Actions**를 선택해야 할 수 있습니다.

배포 주소는 보통 아래와 같습니다.

`https://snumaster.github.io/delivery/`

## 다음 단계
1. 서버리스 백엔드(Cloudflare Workers/Vercel Functions) 추가
2. 택배조회 API 연동으로 상태/이력 자동 갱신
3. Gmail OAuth를 통한 배송메일 운송장 자동 수집
4. 로그인/기기간 동기화
