# claude-code-guide-practice

Claude Code 가이드 실습 프로젝트입니다.

## 요구 사항

- Python 3.13+
- ruff
- mypy
- pytest

## 설치

```bash
python -m venv .venv
source .venv/bin/activate
pip install ruff mypy pytest
```

## 사용법

```python
from ex_pipeline import add

result = add(1, 2)      # 3
result = add(1.5, 2.5)  # 4.0
```

## 개발

### 린트

```bash
ruff check . --exclude .venv
```

### 타입 검사

```bash
mypy ex_pipeline.py test_pipeline.py
```

### 테스트

```bash
pytest test_pipeline.py -v
```
