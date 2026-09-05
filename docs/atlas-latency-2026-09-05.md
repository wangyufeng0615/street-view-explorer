# Atlas latency experiment — 2026-09-05

## Method

Paid, opt-in tests ran in a separate process on the SG production host. They used the production description functions and model (`deepseek/deepseek-v4-flash-vision-exp`), one fixed 640×480 Google Street View frame at -13.53770,-172.39409, the same Paia address context, and unchanged prompt, language validation, token caps and evidence budgets. Standard calls retain a 25-second model deadline; detailed calls retain 60 seconds. Calls were sequential, with variant order rotated between rounds; languages were Chinese, English, Chinese. The frame was fetched once per experiment and shared by its variants.

First-visible latency starts immediately before the model request and ends at the first validated application delta. It excludes location/image preparation and browser/network rendering. Failed calls have no first-visible measurement and are excluded from successful-call medians, but remain in the success denominator. These are small, single-location diagnostic samples, not production percentiles or a causal estimate immune to provider load/cache variation.

## Search and routing comparison

The first experiment used automatic routing/search, latency-sorted routing with automatic search, and automatic routing with Exa fast search (3 ordinary calls each). A second experiment compared automatic and fast search in Chinese and English, followed by one Chinese detailed call per policy.

| Ordinary description policy | Successful calls | Median first visible | Median completion |
| --- | ---: | ---: | ---: |
| Previous auto search/routing | 4/5 | 3.59 s | 6.67 s |
| Latency-sorted routing, auto search | 3/3 | 5.49 s | 8.93 s |
| Exa fast search, auto routing | 5/5 | 2.78 s | 6.45 s |

One original-policy Chinese generation was rejected before becoming visible. Fast search reduced the successful-call first-visible median by about 22%, but completion was nearly unchanged. The single detailed pair was effectively tied (first visible 10.04 vs 10.05 seconds). All six second-experiment calls reported executed search; ordinary results had four citations, detailed results six. These checks establish search execution and response validity, not factual correctness.

Manual prose review still found unsupported local-history extrapolations across policies, including assertions about which village's land was buried, and an internally inconsistent relative date. There is no evidence here to claim fast search improves factual accuracy. Neither search nor existing safeguards may be removed just to get a lower timing number.

Generation API reconciliation found DeepInfra and Fireworks serving the second experiment. The SSE chunks reported `provider=OpenAI` for those same generation IDs. Consequently the application logs this field as `reported_provider`; only generation metadata is suitable for attributing the actual provider. Zero token/cost fields in those metadata responses were not treated as proof of free usage.

## Fixed-provider confirmation and selected policy

A third rotated, six-call experiment kept Exa fast search for both arms and compared automatic routing to Fireworks with fallback disabled for measurement only:

| Case | Auto first / complete | Fireworks first / complete |
| --- | ---: | ---: |
| Chinese ordinary | 3.38 / 7.25 s | 2.54 / 4.44 s |
| English ordinary | 2.17 / 3.68 s | 2.32 / 3.92 s |
| Chinese detailed | 11.22 / 24.90 s | 2.94 / 5.94 s |

All six calls succeeded and reported executed research, with four/six citations for ordinary/detailed output. Detailed output lengths were 547 and 587 Unicode characters respectively; the faster result was not an empty or shortened answer. It still contained unsupported village-level causal claims, as did the auto-routed result. English ordinary latency was slightly worse. The single detailed pair is a useful signal, not a claim of a repeatable 76% speedup.

Selected implementation: Exa fast search plus a Fireworks preference **only** for the evaluated model and its 20260821 version. Production explicitly allows provider fallback; the diagnostic fixed-provider arm did not. Unrelated model overrides retain automatic routing. Set `OPENROUTER_DESCRIPTION_PROVIDER_SORT=off` and `OPENROUTER_DESCRIPTION_SEARCH=auto`, then recreate the backend, to restore the previous policy. No change to model, output length, grounding checks, map cache or paid request limits was needed.

## Reproduction

Normal `go test ./...` skips the paid test. From `backend/`, explicitly supply absolute paths:

```bash
ATLAS_LATENCY_LIVE=1 \
ATLAS_LATENCY_ENV=/absolute/path/to/backend/.env \
ATLAS_LATENCY_OUTPUT=/absolute/path/to/results.jsonl \
go test ./internal/openai -run '^TestDescriptionLatencyLive$' -count=1 -v
```

Set `ATLAS_LATENCY_CONFIRM=1` for the six-call search confirmation, or `ATLAS_LATENCY_CONFIRM=provider` for fast-search auto routing versus Fireworks without fallback, including a detailed pair. `ATLAS_LATENCY_PROXY` explicitly configures a proxy when running locally; the SG tests used direct egress. Output files contain generated prose and metrics, never the credentials or frame payload. They are written with mode 0600. Tests use the same production deadlines and may incur paid model/search/map usage even when validation rejects a response.

The search settings follow the [OpenRouter search tool contract](https://openrouter.ai/docs/guides/features/server-tools/web-search); provider overrides follow the [routing contract](https://openrouter.ai/docs/guides/routing/provider-selection). An engine's advertised search latency is not the latency of the entire model/tool loop.
