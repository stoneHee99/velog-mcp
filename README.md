# velog-mcp

[![npm version](https://img.shields.io/npm/v/velog-mcp)](https://www.npmjs.com/package/velog-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCPAmpel](https://img.shields.io/endpoint?url=https://mcpampel.com/badge/stoneHee99/velog-mcp.json)](https://mcpampel.com/repo/stoneHee99/velog-mcp)

[Velog](https://velog.io) 블로그 플랫폼용 MCP(Model Context Protocol) 서버입니다.

AI 어시스턴트를 통해 Velog 글을 읽고, 검색하고, 작성할 수 있습니다.

> **참고:** 이 프로젝트는 Velog의 비공식 GraphQL API를 사용합니다. Velog의 공식 프로젝트가 아닙니다.

## 주요 기능

- **글 조회** — 사용자의 글 목록, 상세 내용 조회
- **글 검색** — 키워드 기반 글 검색
- **트렌딩** — 인기 글 조회 (일간/주간/월간)
- **글 작성/수정/삭제** — 마크다운 글 작성 및 관리
- **시리즈/프로필** — 시리즈 목록, 사용자 프로필 조회
- **간편 로그인** — Chrome 쿠키 자동 추출로 별도 설정 없이 인증

## 빠른 시작

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

```json
{
  "mcpServers": {
    "velog": {
      "command": "npx",
      "args": ["-y", "velog-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add velog -- npx -y velog-mcp
```

### Cursor / Windsurf

MCP 설정에 동일하게 추가:

```json
{
  "mcpServers": {
    "velog": {
      "command": "npx",
      "args": ["-y", "velog-mcp"]
    }
  }
}
```

> 읽기 전용으로 사용할 경우 추가 설정 없이 바로 사용 가능합니다.

## 도구 목록

### 인증 불필요

| 도구 | 설명 | 주요 파라미터 |
|------|------|-------------|
| `get_user_posts` | 사용자의 글 목록 조회 | `username`, `cursor?`, `limit?` |
| `read_post` | 글 상세 조회 (본문, 댓글 포함) | `username`, `url_slug` |
| `get_trending_posts` | 트렌딩 글 조회 | `offset?`, `limit?`, `timeframe?` |
| `search_posts` | 키워드로 글 검색 | `keyword`, `offset?`, `limit?`, `username?` |
| `get_user_profile` | 사용자 프로필 조회 | `username` |
| `get_series_list` | 사용자의 시리즈 목록 조회 | `username` |

### 인증 필요

| 도구 | 설명 | 주요 파라미터 |
|------|------|-------------|
| `login` | Chrome 쿠키에서 토큰 자동 추출 | — |
| `write_post` | 새 글 작성 | `title`, `body`, `tags?`, `is_private?`, `url_slug?`, `series_id?` |
| `edit_post` | 기존 글 수정 | `id`, `title?`, `body?`, `tags?`, `is_private?` |
| `delete_post` | 글 삭제 | `id` |

## 인증

### 방법 1: 자동 로그인 (권장)

`login` 도구를 호출하면:
1. Chrome에 이미 Velog 로그인이 되어 있으면 → 쿠키를 자동으로 읽어 즉시 완료
2. 로그인이 안 되어 있으면 → 기존 Chrome에 새 탭으로 velog.io를 열어줌 → 로그인 후 자동 추출

추출된 토큰은 `~/.velog-mcp/tokens.json`에 저장되어 다음 실행 시 자동으로 불러옵니다.

### 방법 2: 환경변수

```json
{
  "mcpServers": {
    "velog": {
      "command": "npx",
      "args": ["-y", "velog-mcp"],
      "env": {
        "VELOG_ACCESS_TOKEN": "your_access_token",
        "VELOG_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

토큰 확인: [velog.io](https://velog.io) > 개발자 도구 (`F12`) > **Application** > **Cookies** > `access_token` / `refresh_token`

### 토큰 우선순위

환경변수 > 저장 파일 (`~/.velog-mcp/tokens.json`) > 미인증 (읽기 전용)

### 토큰 만료

| 토큰 | 유효 기간 |
|------|----------|
| `access_token` | 1시간 |
| `refresh_token` | 30일 |

만료 시 `login` 도구를 다시 호출해주세요.

## 사용 예시

```
"이번 주 velog 트렌딩 글 보여줘"
"velopert의 최근 글 목록 알려줘"
"velog에 '오늘의 TIL'이라는 제목으로 글 써줘"
"velog에서 TypeScript 관련 글 검색해줘"
```

## 플랫폼 지원

| 기능 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 읽기 (조회, 검색, 트렌딩) | O | O | O |
| 쓰기 (환경변수 인증) | O | O | O |
| 자동 로그인 (`login` 도구) | O | O | O |

> 자동 로그인은 Chrome 브라우저가 필요합니다. Windows에서는 [sqlite3](https://www.sqlite.org/download.html)도 PATH에 설치되어 있어야 합니다.

## 개발

```bash
git clone https://github.com/stoneHee99/velog-mcp.git
cd velog-mcp
npm install
npm run build
```

## 주의사항

- Velog의 **비공식** GraphQL API를 사용하며, API 변경 시 동작하지 않을 수 있습니다.
- 이 프로젝트는 Velog와 무관한 커뮤니티 프로젝트입니다.
- 과도한 API 호출은 자제해주세요.

## 라이선스

[MIT](LICENSE)
