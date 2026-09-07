# Cursor에서 thevesselcode-pms와 분리해서 관리하기

PMS ISO 심사는 **선박 PMS 앱**(`thevesselcode-pms`)과 **완전히 다른 저장소·채팅·터미널**로 운영하는 것을 권장합니다.

| | thevesselcode-pms | perfect-marine-solution-iso (이 repo) |
|---|---|---|
| 주제 | TVC-PMS **소프트웨어** | PERFECT MARINE SOLUTION **ISO 심사** |
| Cursor 채팅 | PMS 앱, 배포, e2e | **「Pms iso 심사 서류」** (새 채팅) |
| 터미널 | `npm start` → :3000 | `npm start` → :3010 |
| Supabase | (앱용, 별도) | **pms-iso** 전용 프로젝트 |

---

## 1. GitHub 저장소 만들기 (1회, 약 2분)

1. 브라우저에서 [github.com/new](https://github.com/new) 열기  
2. **Repository name:** `perfect-marine-solution-iso`  
3. **Private** 선택 → **Create repository** (README 추가 안 함)

### 이 폴더를 GitHub에 올리기

로컬에서 이 repo 루트에서:

```bash
git init
git add -A
git commit -m "Initial PMS ISO online portal"
git branch -M main
git remote add origin https://github.com/kckimmarine/perfect-marine-solution-iso.git
git push -u origin main
```

> 이미 `thevesselcode-pms`만 clone 했다면, 앱 repo에서:  
> `./scripts/bootstrap-perfect-marine-iso-repo.sh ../perfect-marine-solution-iso`  
> 로 **옆 폴더**에 ISO 전용 repo를 만든 뒤 위 push 명령을 실행합니다.

---

## 2. Cursor에서 **새 프로젝트**로 열기

1. **File → Open Folder…** (Mac: **Open…**)  
2. `perfect-marine-solution-iso` 폴더 선택 (**thevesselcode-pms가 아님**)  
3. 왼쪽 상단 저장소 이름이 `perfect-marine-solution-iso`로 보이면 OK  

### 새 채팅 만들기

- **New Chat** → 이름 예: **「Pms iso 심사 서류」**  
- ISO 문서·체크리스트·증빙·Supabase 설정은 **이 채팅에서만** 진행  

`thevesselcode-pms` 채팅(Bluehost, Toolkit, PMS 앱)과 섞이지 않습니다.

---

## 3. 이 프로젝트 전용 터미널

**Terminal → New Terminal** (`` Ctrl+` ``)

```bash
npm install
npm start
```

브라우저: **http://localhost:3010**

- Supabase URL은 이미 `portal/js/config.js`에 들어 있습니다.  
- **Publishable key**는 포털 첫 화면에 붙여넣기 (localStorage 저장).  
- 로그인: Authentication에서 만든 이메일·비밀번호.

자세한 Supabase 설정: [`docs/쉬운-설정.md`](쉬운-설정.md)

---

## 4. 두 Cursor 창을 같이 쓰는 방법

| 창 | 폴더 | 용도 |
|----|------|------|
| 창 A | `thevesselcode-pms` | 선박 PMS 앱 개발 |
| 창 B | `perfect-marine-solution-iso` | ISO 심사 포털·문서 |

각 창의 터미널·채팅·포트(:3000 vs :3010)가 **서로 독립**입니다.

---

## 5. 이미 thevesselcode-pms에서 로그인에 성공한 경우

`pms-iso-online`이나 Cloud Agent로 테스트했다면 **같은 Supabase(`pms-iso`)** 를 씁니다.  
별도 repo로 옮겨도 **데이터는 그대로**이고, Publishable key만 새 브라우저/포트에서 다시 한 번 입력하면 됩니다.

---

## Cursor Cloud Agents (로컬 PC 없이) — **권장**

로컬이 아니라 **브라우저의 Cursor Cloud**만 쓸 때는 아래 순서입니다.

### ① GitHub에 코드 push (먼저)

빈 repo만 있으면 Environment를 만들 수 없습니다. **한 번** 코드를 올려야 합니다.

- 방법 A: 이 채팅(thevesselcode-pms Cloud Agent)에서  
  `./scripts/bootstrap-perfect-marine-iso-repo.sh` 후 `perfect-marine-solution-iso`로 push 요청  
- 방법 B: GitHub 웹에서 파일 업로드 (비추천)

### ② Cloud Agents → **Environments** → **New**

| 항목 | 값 |
|------|-----|
| Repository | **`kckimmarine/perfect-marine-solution-iso`만** (`thevesselcode-pms` 선택 안 함) |
| 이름 예 | `PMS ISO 심사 포털` |
| install | `npm install` |
| start / terminals | `npm start` (포트 **3010**) |

repo에 `.cursor/environment.json`이 있으면 위 값이 자동 제안됩니다.

**Guided setup**이 뜨면 Agent가 `npm install` → 포털(:3010) 기동까지 검증 → **Save**.

### ③ Secrets (ISO Environment에만)

- Supabase `DATABASE_URL` 등은 **이 Environment의 Secrets**에만 (PMS 앱과 분리)
- Publishable key는 포털 첫 화면 localStorage (파일 수정 불필요)

### ④ 매일 ISO 작업

1. **Cloud Agents** → **New Agent**  
2. Repo: `perfect-marine-solution-iso`  
3. Environment: 방금 만든 **ISO Environment**  
4. 채팅 주제: **「Pms iso 심사 서류」** (thevesselcode-pms Agent와 **별도**)

### 하지 말 것

- `thevesselcode-pms` Environment에 ISO repo를 multi-repo로 추가  
- ISO 작업을 thevesselcode-pms Cloud Agent 채팅에 섞기  

---

## 요약

**로컬 Cursor:** Open Folder → `perfect-marine-solution-iso` → `npm start` (:3010)

**Cursor Cloud:** Environments → New → ISO repo만 → New Agent → 「Pms iso 심사 서류」

이후 ISO 관련 요청은 **ISO 전용 Agent 채팅**에만 보내 주세요.
