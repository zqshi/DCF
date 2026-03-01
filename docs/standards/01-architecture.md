# 01 Architecture (DDD-lite)

## Layers

1. `domain`: entities and pure domain services
2. `application`: use-cases orchestrating domain behavior
3. `infrastructure`: repositories and external integrations
4. `interfaces`: HTTP/API presentation
5. `shared`: cross-cutting utilities

## Rules

1. `interfaces` cannot directly depend on `domain` internals without use-cases.
2. `domain` has no dependency on HTTP, filesystem, or framework code.
3. External services (GitHub/OpenHands/AgentScope) must sit behind adapters.
4. Business vocabulary lives in domain names, not controller files.
