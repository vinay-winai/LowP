# Mobile performance checks

## October 2: search inside the retained Zepto page

Enabled for Zepto in full-page scheduling mode (including limiter off).
After a successful search, a different query uses the store's search input and
Enter event, retaining its WebView and initialized page. First use, identical
uncached queries, extraction-only scheduling, and other stores retain normal
navigation. Amazon Now, Swiggy, and Blinkit reuse trials did not pass the
readiness check reliably and are not enabled.

The URL and input must match the new query, every previous product card must
detach, and new cards must remain present for 350 ms before extraction. Initial
Next.js JSON is skipped after SPA navigation because it can describe the old
query. Host messages validate store/request identity and reject premature
results. Missing controls or an unverified transition trigger normal navigation:
2.8 seconds in-page, with a 3.2-second native watchdog. Fallback retains the
original nine-second search budget and disables further attempts for that store
until remount. Superseded checks dispose timers. Cookies/settings are untouched.

SM-M336BU / Exynos 1280, Expo Go on port 8081, four-store 10 min pack, three active
pages, retained store caches/sessions, battery temperature around 36 C:

| Trial | Zepto | All four stores |
| --- | ---: | ---: |
| Butter via search input (earlier 1.8-second guard) | 1.760 s | 4.758 s |
| Same butter query via normal reload, LowP query cache cleared | 5.473 s | 6.137 s |
| Final build: butter via search input | 1.905 s | 4.612 s |
| Final build: paneer via search input | 1.888 s | 4.828 s |

All four stores returned candidates in these trials. One earlier paneer reuse
attempt exceeded the shorter guard and successfully fell back (6.647 s pack).
The final two searches reused the Zepto document. These are small development
samples, not release medians or a claim of faster cold startup. The reload
comparison ran after the warm-input trial, with browser caches retained.

Validation: 128 tests and mobile TypeScript passed, including unchanged-card and
wrong-URL rejection, absent inputs, superseded requests, premature results,
native fallback/watchdog, source retention, and existing search/session tests.

Current configuration: "Limit parallel searches" is enabled by default and allows three active WebViews. Turning it off allows six. Selected views remain mounted with stable store keys; waiting views keep their previous documents (or about:blank on first use), completed views disable JavaScript, and each active page receives its own 9-second deadline starting when it is dispatched. Amazon.in/Flipkart HTTP searches always start in parallel and can finish queued stores without navigating their WebViews. The switch is persisted and disabled during an active search. The earlier unrestricted/staged measurements below are historical context.

Validation after removing the staging gate: all 40 tests and mobile TypeScript pass. After the user re-added Amazon.in/Flipkart, two simultaneous six-store searches completed without timeouts: Butter 3.696 seconds and Fortune Oil 4.154 seconds. The same six DevTools target IDs survived the query change. Amazon.in returned at 1.258/1.529 seconds; Flipkart at 2.568/2.834 seconds. These are Expo development measurements with retained sessions/caches, not controlled release-build medians. Exynos testing remains pending.

## September 30, 2026

Device: I2221, Snapdragon 8s Gen 3; Android WebView 153.0.8010.36.
Source tested in Expo Go 57 over USB reverse, with existing cookies and website caches.
The installed `com.lowp.app` APK was not replaced or cleared.

Changes:
- Keep one scraper per document/request despite repeated native injections.
- Dispose observers, timers and document listeners on completion/replacement/navigation.
- Coalesce mutations without continually postponing the next extraction.
- Skip sponsored-badge scans when there are no DOM-backed candidates; limit empty-state text checks to once per 600 ms.
- Fix the loading-page fallback's out-of-scope `cards` reference.
- Validate store/request identity, ignore superseded work, and restore cache hits without new store searches.
- Reject rating-only text accidentally selected as a product name.
- Reuse WebView instances across live queries within a pack; cache hits retain idle views. Pack changes release stores outside the current live pack.
- Match the full query URL before extraction, explicitly reload identical uncached URLs, and cancel superseded Big Pack HTTP requests.
- Use an 8.5-second elapsed extraction budget with a 9-second native deadline per loading phase.
- In mixed packs, resolve quick-commerce stores before starting Amazon.in/Flipkart. Disable JavaScript in parked/completed views and stop outstanding loading after accepting a result; re-enable it for a fresh request.

Cookies, user agent, extraction selectors, ranking and candidate settlement thresholds remain as before. WebView inspection is enabled only for development builds.

### Observed timings

| Pack / query | Amazon | Instamart | Zepto | Blinkit / Flipkart | All results |
| --- | ---: | ---: | ---: | ---: | ---: |
| Quick / Paneer 200g | 3.820 s | 2.711 s | 3.530 s | 2.355 s | 3.971 s |
| Quick / Amul Butter 500g | 3.148 s | 1.833 s | 3.023 s | 1.351 s | 3.265 s |
| Quick / Basmati Rice 1kg | 3.382 s | 1.447 s | 3.047 s | 1.551 s | 3.483 s |
| Big / Paneer 200g | 0.954 s | — | — | 4.056 s | 4.154 s |
| Big / Logitech M170 mouse | 1.207 s | — | — | 1.035 s | 1.296 s |

The pre-change source's first Paneer search took 4.594 s on this device. This is one before/after sample with retained website caches, not a controlled speedup estimate or a release-build benchmark. Fast Refresh timings during edits are excluded. The older installed APK's timings are not directly comparable to Expo development runs.

Checked live before reuse: quick and big packs return candidates; cached query restoration makes no new search; rapid Big Pack replacement (~130 ms apart) only delivers results for the latest query. Zepto's existing session still exposes Log Out and Signed in.

After reuse, a clean-launch quick-pack sequence returned all four stores for Paneer (3.784 s), Butter (3.135 s) and Rice (3.796 s). Android DevTools target IDs were unchanged across Paneer/Butter, confirming the same WebView instances. A new Milk search immediately replaced by cached Butter restored Butter correctly.

Loading six pages together repeatedly timed out Amazon Now and Zepto at 9 seconds. One instrumented run showed late bridge messages around 20 seconds; valid products existed in the loaded documents. This does not establish an Amazon account/session conflict. Staging the big stores produced complete six-store Paneer/Butter runs at 6.004/5.478 seconds with unchanged WebView target IDs. However, subsequent pack switching still regressed; idle-page JavaScript is now disabled as well.

After pausing parked/completed JavaScript, the six-store sequence completed at 5.930 s (Paneer), 5.230 s (Butter), and 5.154 s (Rice), with no store timeouts. Butter exposed an existing Amazon title fallback selecting delivery text; the final code now requires product title fields/image alt on Amazon.in and accepts longer authoritative titles. A later Big-only Butter search returned product titles rather than MRP/date metadata (1.330 s total). Relevance of broader grocery matches on Amazon.in/Flipkart is still governed by the existing matching behavior; performance success does not establish pack-size equivalence.

After that final title fix, switching from the Big pack back to six stores started Butter and replaced it with Paneer ~138 ms later. Only Paneer delivered results, all six completed in 4.678 s, and the original two big-store WebView IDs survived the pack switch. An exact cached repeat restored without navigating the live views. Automated lifecycle checks cover both this cancellation path and cache restoration. Big-only Logitech/Rice reuse had already passed, with unchanged target IDs.

One 54-second callback delay is excluded from timing comparisons; device scheduling/foreground state was not controlled during that run. Subsequent checks temporarily kept the USB-connected phone awake; the original setting (0) was restored. Fast Refresh results during source edits are excluded.

Big-only pack reuse was checked with Logitech M170 mouse (1.964 s total; Amazon.in 1.273 s, Flipkart 1.856 s), followed by Rice (1.611 s total; Amazon.in 0.931 s, Flipkart 1.513 s). The two WebView target IDs stayed unchanged.

Automated regression checks cover all six store shells, duplicate/replacement cleanup, immediate settlement, request identity, full-query navigation guards, rating/MRP/date text rejection, long Amazon titles, mutation coalescing, slow hydration, staged loading/deadlines, parked JavaScript, cache restoration and superseded results. Full suite: 40 passing tests; mobile TypeScript passes. These are correctness checks, not end-to-end performance benchmarks.

### Later Exynos 1280 comparison

Use the same build mode for before/after (prefer release), Wi-Fi, store sessions, address, pack and query sequence. Do not clear app data or sign out. Capture each store and total duration from LowP logs, candidate titles/prices/counts, and failures/timeouts. Run at least five app-restart trials and five different-query trials; report medians and range. A restarted app still retains website caches, so label that separately from a truly cold website cache. Check both packs, an exact cached repeat, rapid query replacement, empty results and login indicators. Do not treat a fast incorrect/empty result as a performance improvement.

### No amzn baseline, September 30–October 1

Five paired trials on Snapdragon 8s Gen 3 (I2221, Android 16), Expo Go development via USB reverse 8082. The pack contains Instamart, Zepto, Blinkit, Amazon.in and Flipkart; Amazon Now is excluded. Existing sessions and website caches were retained. Source hashes and raw timings are saved in `benchmarks/no-amzn-snapdragon-2026-09-30.json`.

| Round | First query after app restart: Paneer 200g | Following query: Amul Butter 500g |
| --- | ---: | ---: |
| 1 | 3.79 s | 2.78 s |
| 2 | 3.82 s | 3.02 s |
| 3 | 3.90 s | 3.08 s |
| 4 | 3.51 s | 3.12 s |
| 5 | 3.794 s | 3.582 s |
| Median | 3.794 s | 3.08 s |
| Range | 3.51–3.90 s | 2.78–3.582 s |

First four pairs use app UI totals rounded to 0.01 seconds. Restarting Expo restored Metro console logs for round 5. Invalid clipped per-store UI readings were discarded; only round 5 has verified per-store timings. Capture repair lengthened the gap between round 5 queries. All five stores responded in that final pair without timeouts, but Amazon.in/Flipkart returned unrelated products and other stores returned alternative brands/sizes. These are response-completion timings, not evidence of correct SKU comparisons or a controlled speedup.

For Exynos 1280, use the same source hashes, Expo build mode, WebView version where possible, pack, Wi-Fi, delivery address, sessions, query order and 12-second capture delay. Run `./mobile/benchmarks/run-no-amzn.ps1 -Round 1 -Soc 'Exynos 1280' -Output 'mobile/benchmarks/no-amzn-exynos.json'` from the repository root, repeating for rounds 2–5. The script captures total timings only; retain Metro logs separately for per-store timing and product correctness. Do not clear app data. Verify each phone independently and compare medians/ranges; this baseline is not a release-build performance claim. The phone's original USB awake setting was restored after testing.

### Exynos 1280 baseline, October 1, 2026

Samsung SM-M336BU, Android 16, WebView 153.0.8010.36, Expo Go 57.0.9 over USB reverse 8082. The same three performance source hashes match the Snapdragon baseline. No amzn contains five stores and excludes Amazon Now. User reported stores likely logged out; logins were not changed or independently verified. Five paired trials retained website caches and restarted only Expo Go between pairs. Capture waits 12 seconds after submission; a 2-second pause after pack selection lets the UI settle before either query. Raw results: `benchmarks/no-amzn-exynos-2026-10-01.json`; parsed console evidence: `benchmarks/exynos-metro-results-2026-10-01.json`.

| Round | Paneer after restart | Following Butter query | Zepto restart / following |
| --- | ---: | ---: | --- |
| 1 | 9.197 s | 6.337 s | Timeout / result |
| 2 | 8.690 s | 6.634 s | Result / result |
| 3 | 7.188 s | 6.160 s | Result / result |
| 4 | 8.943 s | 6.849 s | Result / result |
| 5 | 9.385 s | 8.328 s | Timeout / result |
| Median | 8.943 s | 6.634 s | 3/5 results / 5/5 results |
| Range | 7.188–9.385 s | 6.160–8.328 s | |

Only Zepto timed out: twice after app restart, zero times on following queries. Its following-query durations were 6.187, 6.361, 6.041, 6.511 and 8.124 seconds. All other store requests responded in these ten searches. This is encouraging relative to the user's report that the old APK also timed out Zepto on consecutive queries, but an old/new controlled comparison was not performed and no quantified speedup can be claimed. First-query latency remains unresolved on Exynos. The total includes timeout completion rather than five successful responses in rounds 1 and 5.

Results still include unrelated Amazon.in/Flipkart matches and alternate brands/pack sizes from quick-commerce stores. These timing tests do not establish comparison correctness. The Snapdragon and Exynos sessions, delivery inventory/address and website cache state differ, so their medians do not isolate CPU performance. All timing values above come from Metro logs; rounded UI totals are retained separately. No app source changed during the Exynos trials; the original screen-awake setting (0) was restored. The older installed APK and login data were preserved.


### Active-page concurrency experiment, October 1, 2026

Implemented a persistent "Limit parallel searches" switch beside the store pills. Default on means three active pages; off permits six. All selected store views remain mounted, including blank/parked views. A queued view navigates when a slot becomes available, while completed views stop loading and disable JavaScript. Store deadlines start at dispatch, so waiting time does not consume the page's 9-second allowance; total search time can therefore exceed 9 seconds. HTTP fetches remain parallel and can resolve queued Amazon.in/Flipkart without page navigation. Cache restoration keeps documents unchanged, generation guards cancel/ignore superseded requests, and toggling clears the result cache so the next request actually exercises the new policy.

Development diagnostics measure page lifecycle, navigation milestones, first-candidate delay, cumulative extraction scans, and observed long tasks. They run only for development-generated scraper scripts; production extraction has no timing observer. `exynos-concurrency-profile-2026-10-01.json` contains parsed Metro results. Two active pages were screened with one restart/following pair; three with two pairs. A Rice off/on check and Big Online check were also run. Fixed capture delay was 20 seconds for the screened pairs; actual response durations came from app logs.

The timing observations point to store-page JavaScript/hydration and waiting for store data as larger costs than the extraction scan itself. In a complete three-page Paneer trial, Instamart measured 41ms of extraction scans, 1,135ms of observed long tasks, and a 4.571s response; Blinkit measured 48ms scans, 784ms long tasks, and a 4.137s response; Zepto measured 31ms scans, 542ms long tasks, and a 6.235s response. Long tasks are observed only after scraper injection and include any overlapping extraction; scan durations measure wall time, not isolated CPU cycles. Network/API waits and scheduling still contribute. These measurements do not prove that all elapsed delay is CPU-bound, nor that parallel loading with delayed scraping alone would be safe.

A complete five-response three-page search finished in 6.315s, but other trials finished near 9s with missing products. Direct development inspection found explicit login gates: Zepto "Oops! Please login to continue searching" and Instamart "Log in to continue shopping ... Log in with phone number". A login-gated Zepto document loaded in 1.351s, yet the scraper waited its extraction budget; 163ms of scanning does not account for that wait. These blocked runs are not comparable to earlier successful product searches, so no reliable overall speedup or two-versus-three winner is claimed. User did not want to require store login for this test. Three remains the provisional default, and the switch allows unrestricted operation on faster devices. Big-store HTTP responses also succeeded more often during this experiment than in the earlier baseline, which further limits before/after attribution.

Native checks: five DevTools page IDs were identical before and after query/toggle changes (`exynos-reuse-before.json`, `exynos-reuse-off.json`, `exynos-reuse-on.json`), confirming reuse. Toggle off dispatched all five selected pages together; on dispatched three. The setting remained on after a full Expo Go restart. Big Online Rice returned both stores in 1.233s while limiting was on. No application data or logins were cleared; the screen-awake setting was restored to 0 and the debug forward was removed.

Regression validation: 44 tests pass and mobile TypeScript passes. Scheduler tests cover six simultaneous pages when unrestricted, two/three active slots with six retained mounts, slot release after completion/timeout, per-dispatch deadlines, stable documents/keys, superseded callbacks/timers, cache parking, queued HTTP success skipping navigation, and cancellation of stale HTTP work. Scraper diagnostics preserve request identity and settlement/cleanup.

Follow-up user observation: after signing into Swiggy and Zepto, the five-store pack reportedly completed without timeouts, approximately 6 seconds with limiting versus 7 seconds without. These are user-observed approximate timings, not additional paired benchmark trials. They are encouraging, but the earlier login-gated runs cannot be used as a controlled comparison. The switch now has explicit blue/gray thumb and track colors so Android's disabled state during a search does not turn it white; mobile TypeScript passes after this styling change.

### Logged-in comparison of all limits, October 1, 2026

After the user signed into Swiggy and Zepto, a fresh-launch three-page warm-up returned products from all five stores in 6.671s. The measured matrix then used the same running app and five-store No amzn pack for 21 searches: seven configurations across Paneer 200g, Amul Butter 500g and Basmati Rice 1kg. Each configuration had one trial per query, with order varied between query blocks. Options were changed through the native UI; selecting the count cleared LowP's exact-query result cache before every request. There were no source edits or app restarts during the 21 measured trials. No UI dumps were taken during loading; Metro completion was captured first, then the UI's rounded total was cross-checked. Website caches, store logins and delivery addresses were retained. Battery temperature remained 37.4–38.0 C across measured submissions.

"Full" limits page loading, website JavaScript and extraction together. "Parallel load" starts all selected pages and their website JavaScript together, queuing only LowP's extraction; it injects the scraper into a queued document when a slot opens without navigating it again. Document/request identity protects against reading the previous page during a reload. Both modes keep WebViews mounted. Big-store HTTP fetches remain parallel in every configuration. The policy is captured when a new search begins, so a settings change does not alter an in-flight request.

| Active limit | Full workload median | Parallel load, limited extraction median |
| --- | ---: | ---: |
| 1 | 8.413 s | 7.711 s |
| 2 | 7.384 s | 7.679 s |
| 3 | **6.164 s** | 7.351 s |
| Unrestricted | 7.176 s | Same unrestricted baseline |

All **105/105 store requests returned products**. There were **zero native timeouts and zero no-candidate responses** in the measured matrix. The approximately 6s-versus-7s observation is reproduced in the medians (1.012s difference), and three full page workloads are the best measured limited configuration. Limiting extraction alone did not improve the median over unrestricted searching in this sample. This does not establish a universal one-second gain: the matched-query results were:

| Query | Three full pages | Unrestricted | Three-page benefit |
| --- | ---: | ---: | ---: |
| Paneer 200g | 5.790 s | **5.085 s** | -0.705 s |
| Amul Butter 500g | **6.690 s** | 7.176 s | 0.486 s |
| Basmati Rice 1kg | **6.164 s** | 8.151 s | 1.987 s |

The mean matched-query benefit is 0.589s, and the median matched-query benefit is 0.486s; the 1.012s figure is the difference between each configuration's three-query medians. These are exploratory warm-query measurements on one device, not a broad performance guarantee. They support keeping the Exynos phone at three full page workloads, with parallel page loading off. The user can now choose 1/2/3 and the loading policy in Options. The main switch still restores unrestricted searching when off. After testing, the phone was restored to limit on, count 3, full workload; USB screen-awake setting was restored to 0.

Data and reproducibility: `benchmarks/logged-in-concurrency-matrix-2026-10-01.json` contains the protocol, source hashes, order, exact durations, store outcomes, product titles/prices, phase timings and temperatures. `benchmarks/logged-in-concurrency-summary-2026-10-01.json` contains aggregate and matched-query comparisons. Block checkpoint files preserve intermediate capture. The exact source hashes matched again after testing. Correct product response timing is distinct from exact SKU matching, which was not changed or validated here.

Validation after adding extraction-only mode and persistent Options: mobile TypeScript and all **47 tests** pass. New lifecycle checks cover parallel page loading with one extraction slot, deferred injection into an already loaded page without navigation, queued-page network errors, stale-document errors, and applying updated settings to the next request. No store credentials or account data were cleared or changed by automation.

### Current pack latency check after comparison editing, October 1, 2026

The user's current No amzn pack contains Zepto, Instamart, Blinkit, Flipkart and **Amazon Now**, whereas the earlier 21-trial matrix contained Amazon.in. Amazon Now needs a fourth store WebView; Amazon.in usually finishes through the parallel HTTP path. These are different workloads. In the recent oats log, Blinkit waited 6.650s for a slot and completed at 10.905s; Instamart timed out at 9.077s. Flipkart quantity detail enrichment starts after search completion and is excluded from the displayed search total.

Four warm Milk 1L searches were measured with this current pack, unchanged source, no restarts, no UI dumps during loading, retained accounts/location, and query cache cleared through Options before each submission. Battery temperature was 37.2–37.3 C. Settings alternated three full pages and unrestricted:

| Trial | Three full pages | Unrestricted |
| --- | ---: | ---: |
| 1 | 9.061 s | 6.285 s |
| 2 | 7.016 s | 6.849 s |

All 20 store requests returned products. In the limited trials, Blinkit waited 5.144s and 4.601s before dispatch; unrestricted dispatch took 56ms and 66ms. Its extraction scan work was 41ms/25ms limited and 71ms/33ms unrestricted. These observations support queue delay and store page readiness as substantial costs, rather than seconds of LowP extraction work. Two repetitions of one query do not establish an overall average or justify changing the previously requested default. Restored limit on, count three, full workload after testing. Comparison edits operate locally and do not initiate store navigation or searches.
# Exynos follow-up, October 2, 2026

Current evidence: store website startup, API readiness/rendering and queue delay dominate successful searches. Reusing WebView instances improves reliability but each new query still navigates and reruns the store application. The timings below are development-mode measurements, not an isolated CPU profile or a release-build benchmark.

Image experiment: `benchmarks/exynos-images-2026-10-02.json` records four warm five-store trials (Instamart, Zepto, Blinkit, Amazon.in, Flipkart), limit 3 full pages, unchanged source and retained website sessions/caches. CDP remained attached in both modes; blocked mode rejected only network Image requests. Query cache was reset through Options before each request. No UI dumps ran during loading. Paneer: normal 5.333s, blocked 5.249s. Butter: blocked 5.364s, normal 4.940s. All stores returned candidates; exact SKU correctness is separate. There is no consistent speed gain. Image counters confirmed 112 blocked requests across both blocked trials, but memory-cached images bypassed interception; this particularly weakens the Paneer comparison. Blocking was removed after testing. No image-blocking app default was introduced.

In the normal Butter trial, Zepto's search requests started at navigation-relative 2.366s and 2.924s, lasting 201ms and 420ms. The last response ended at 3.343s and the first extractable candidate was observed around 4.105s (script start + first-candidate delay). Scanning used 31ms total. Swiggy's search API started at 2.144s and took 420ms; Blinkit's search calls started at 1.912s/2.455s and took 257ms/231ms. These support substantial work/delay before requests and between response and usable cards. They do not prove all elapsed delay is CPU saturation: network waits, website sequencing and scheduling contribute.

10-minute pack: `benchmarks/exynos-ten-minute-2026-10-02.json` records Amazon Now, Instamart, Zepto and Blinkit. Paneer took 6.617s with limit 3 versus 5.630s unrestricted. With limit 3, Blinkit waited 4.245s for dispatch. Butter took 6.847s limited versus 8.984s unrestricted, but unrestricted was confounded by an explicit Swiggy login gate (verified on the page), so those totals cannot establish a concurrency winner. A pack-switch warm-up also had two timeouts; it overlapped a failed Options attempt and is not a clean benchmark. Keep the existing limit-3 default pending broader trials.

After reconnecting to the user's Metro port 8081, a first Butter search took 9.433s with a Zepto deadline; later inspection found product cards and a finalized scraper, consistent with a late result rather than expensive scanning, but no exact bridge-arrival time was captured. The following Paneer search returned all four stores in 6.730s: Swiggy 3.063s (39ms scans), Amazon Now 5.383s (146ms scans), Blinkit 6.116s (24ms scans, including 3.430s queued), Zepto 6.661s (28ms scans). These are a separate app run and cannot be combined as controlled before/after samples.

Implemented improvement: explicit visible Swiggy/Zepto search-login gates now end with `login_required` after two stable checks, releasing their slot instead of consuming the full extraction allowance. Generic header Login text, hidden copy and transient gates do not trigger it; valid products take precedence. The result card explains that sign-in is required. Login gates are checked only while no product was extracted. Automated tests cover settlement/cleanup, transient/hidden copy, successful products, stale job rejection and propagating the reason. A normal live four-store search passed; the new early-exit branch has not yet been reproduced on a live gated page. No success-latency reduction is claimed from this fix.

Next experiments with the best potential: prototype a store-specific path that searches within an already initialized store application; separately evaluate parsing the store's own product responses before DOM rendering. Both need explicit product/price/size validation, current session/location handling and a full-page fallback before adoption. Tightening the existing bounded DOM walks is a smaller opportunity (typically tens of milliseconds, about 0.1–0.2s for Amazon Now here). Image/network blocking would require a properly integrated native request policy for production; the CDP probe is development-only.
