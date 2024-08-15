# NodeBB Plugin DB Search 한국어 검색

사용자가 게시물과 주제를 한국어로 검색할 수 있는 플러그인입니다. <br />
(정확히 이야기 하면 색인을 해주는 플러그인 입니다.) <br />
meilisearch, elasticsearch 컨테이너 관리하다 화딱지 나서 만들었습니다. <br />
한번 색인할 때 사용하고 놀고있는 컨테이너도 보기 싫어서요

## 설치 방법

1. mecab-ko가 설치되어야 합니다.

```bash
set -eux; \
    dpkgArch="$(dpkg --print-architecture)"; \
    case "${dpkgArch##*-}" in \
        amd64) mecabArch='x86_64';; \
        arm64) mecabArch='aarch64';; \
        *) echo >&2 "unsupported architecture: ${dpkgArch}"; exit 1 ;; \
    esac; \
    mecabKoUrl="https://github.com/Pusnow/mecab-ko-msvc/releases/download/release-0.999/mecab-ko-linux-${mecabArch}.tar.gz"; \
    mecabKoDicUrl="https://github.com/Pusnow/mecab-ko-msvc/releases/download/release-0.999/mecab-ko-dic.tar.gz"; \
    wget "${mecabKoUrl}" -O - | tar -xzvf - -C /opt; \
    wget "${mecabKoDicUrl}" -O - | tar -xzvf - -C /opt/mecab/share
```

2. node로 설치

```bash
    pnpm install https://github.com/NavyStack/nodebb-plugin-dbsearch-korean.git
```

## 귀찮다 하시면

[https://github.com/netvpc/nodebb.git](https://github.com/netvpc/nodebb.git)<br />
제가 만든 도커 이미지를 사용하시는 것도 방법입니다.<br />
Nginx 까지 통합입니다.<br />
tini, gosu도 사용합니다 (1001:1001)

```bash
docker pull ghcr.io/netvpc/nodebb:latest
```

## Askfront.com

초보자도 자유롭게 질문할 수 있는 포럼을 만들었습니다. <br />
NavyStack의 가이드 뿐만 아니라, 아니라 모든 종류의 질문을 하실 수 있습니다.

검색해도 도움이 되지 않는 정보만 나오는 것 같고, 주화입마에 빠진 것 같은 기분이 들 때가 있습니다.<br />
그럴 때, 부담 없이 질문해 주세요. 같이 의논하며 생각해봅시다.

[AskFront.com (에스크프론트) 포럼](https://askfront.com/?github)
