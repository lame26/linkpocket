# NEXT TASKS

완료 항목 상세 이력은 `HISTORY.md`를 기준으로 확인한다.

## P0 (바로 진행)
- [ ] 수동 업로드된 구글 URL 치환 SQL 실행 (`supabase/sql/20260306_replace_google_links_with_article_urls.sql`)
- [ ] 기존 수동 업로드 링크 `published_at` 백필 SQL 실행 및 결과 검증
- [ ] Cloudflare Pages 환경변수(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`) 고정 등록 상태 최종 점검

## P1 (유저 편의성)
- [ ] 상단 빠른 추가 바 + 단축키 (`Ctrl/Cmd + K`)
- [ ] 삭제 후 5초 Undo 토스트
- [ ] 필터/정렬 상태 LocalStorage 복원
- [ ] 모바일 상세 패널 하단 액션 고정
- [ ] import 진행률 UI(n/m) + 중단/재시도 UX
- [ ] import 완료 항목 일괄 재분석 버튼

## P2 (완성도/운영)
- [ ] 스켈레톤 로딩 카드 추가
- [ ] 저장 -> AI 자동분석 E2E 체크리스트 문서화
- [ ] 인증/저장 실패 네트워크 로그 템플릿(401/CORS/500) 추가
