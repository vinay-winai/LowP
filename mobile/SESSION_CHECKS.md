# Automatic account checks

**Current scheduling:** Account checks run only after the user presses **Sync** beside the Store Sync title. Launch and foreground return do not enqueue new checks. Fresh saved observations still restore, interactive store pages still update observations, and a manually started queue still pauses/resumes for searches, store windows and backgrounding. The old bottom refresh button has moved into the header and animates while checks run. The automatic-launch sections below are historical. Manual scheduling, stale-token protection and pause/resume regressions pass with all 120 tests; mobile TypeScript passes.

Store Sync's shared location input and the interactive store input now accept only six numeric PIN digits. Set/Reset location remains tappable with an empty or incomplete input and shows an **Enter the PIN code** alert instead of opening the store. Save and Fill address validate the same PIN format. Previously saved full address text restores only its valid PIN, if present. No lookup or automatic match selection is performed. Validation: 120 tests and mobile TypeScript pass.

Amazon.in now supplies the exact same location observation and timestamp for Amazon Now, as requested; Now-specific location messages cannot override it. Shared expiration prevents Now from appearing fresher than Amazon.in. Zepto location detection includes the address-container/location-selector controls and lets its home header hydrate for up to 2.4 seconds before account navigation (earlier if a location cue appears). A fresh home location remains intact when account pages have no location cues. These changes pass 119 tests and mobile TypeScript; this update was not verified live on the phone.

Location setup is now available for every account status, including Signed in. A fresh confirmed location changes the action and store-window heading to **Reset location**; otherwise the action says **Set location**. Both reopen the store's location search and fill the saved query. The user still chooses the matching location; resetting does not delete cookies or automatically apply an address. Signed-in address-search regression, all 118 tests and mobile TypeScript pass.

**October 2 update:** Clear cache/cookies was removed at the user's request, including the sync/store-window buttons, reset callbacks, JavaScript reset script, Android native module and reset-only tests. Older clearing sections below describe historical work, not current functionality. Login checks and address setup remain available. Current validation: 118 tests pass, mobile TypeScript and whitespace checks pass. Mobile matching now weights descriptive text after a spaced hyphen or typography dash at 25%; quantity checks, variant safeguards and unspaced word hyphens remain intact.

Implemented and verified on October 1, 2026.

The launch queue checks Amazon.in, Instamart, Zepto, Blinkit and Flipkart sequentially after storage and the initial screen are ready. Amazon.in supplies both Amazon pills. Each dispatched check has an eight-second deadline; queue waiting time is separate. Searches, backgrounding and the interactive store window pause the queue and invalidate the interrupted probe. Resumption uses a new token and the existing mounted WebView.

Account adapters only hover/open account controls, open Swiggy's Logout Options submenu, and scroll evidence into view. They never submit phone forms, choose delivery locations or activate logout. Explicit logout controls prove signed in; recognized login controls/prompts or a phone field with nearby login context prove signed out. Conflicting evidence, failed pages and deadlines yield Unknown. Exact cue filtering avoids repeated layout inspection of unrelated text on large store pages.

Validated status, evidence and observation time persist under `lowp_store_sessions_v2`. Restoration accepts only observations younger than five minutes. Every launch still checks afresh. Foreground return queues expired observations. Product-page observations use separate search tokens and an observation epoch, which changes when the interactive window opens or the app backgrounds; delayed product messages cannot overwrite newer interactive observations.

## Connected Exynos verification

Device: Samsung SM-M336BU, Android 16, Expo Go over USB. Existing APK, cookies, delivery settings and pack contents were retained.

The final launch run obtained:

| Store | Pill status | Evidence |
| --- | --- | --- |
| Amazon.in | Signed in | Sign Out control in account menu |
| Amazon Now | Signed in | Mirrored Amazon.in observation |
| Swiggy Instamart | Signed in | LOGOUT control inside Logout Options |
| Zepto | Signed in | Log Out control on account page, after the correction below |
| Blinkit | Signed in | Logout control on account page |
| Flipkart | Signed out | Login prompt after interrupted check resumed |

Pill labels were inspected across No amzn and 10 min pack; No amzn was restored afterwards. Find title remained enabled for Amazon Now. No pack contents or account settings were changed by the checks.

Backgrounding paused Flipkart's active check. Returning to the existing app task resumed it; a Paneer 200g title search then interrupted it again. The search dispatched in 76 ms, returned a product in 3.608 s, and completed the UI in 3.797 s. Flipkart resumed afterwards and its signed-out evidence passed native message validation. No account check continued alongside this search.

All five WebView page identities present before interruption were unchanged after resumption and the subsequent five-store search. Amazon Now added its own sixth view once; the subsequent pack search retained all six identities. An interruption bug was fixed: parked views must retain their source URL so a stopped account document reloads on resume. Reload waits 100 ms for the native JavaScript-enabled property to commit, within the existing eight-second deadline.

The subsequent five-store Milky Mist Paneer200 g search dispatched its three page slots in 74 ms. Flipkart and Amazon.in returned through HTTP in 1.432 s and 2.359 s; Instamart and Blinkit returned in 5.573 s and 6.359 s. Zepto timed out at 9.093 s, so the full query took 9.188 s. This confirms dispatch is not waiting for account checks; it does not establish a speed improvement or resolve Zepto's product-search timeout. Returned products did not change the detector's observation. Its signed-out result was subsequently found to be incorrect.

### Zepto correction

The user reported Zepto was signed in. Its interactive account page had a visible Log Out control, while the background home page's account button initially displayed `aria-label="login"`. After hydration that same home control became a profile link to `/account`. The initial header label was therefore ambiguous and the earlier signed-out result was false.

The detector now ignores Zepto's generic aria-labelled login button outside a login form/dialog, including on product pages. The launch adapter loads home, then navigates directly to the verified read-only `https://www.zepto.com/account` route in the same WebView. It does not click that initial login button, which can invoke Zepto's external login SDK. Inspection continues throughout the native eight-second deadline instead of stopping its adapter after six ticks. A fresh native launch then produced validated signed-in evidence from Log Out. The session cache moved to v2 to invalidate the old false observation; store cookies, packs and delivery settings were retained. Regression assertions cover the ambiguous header, explicit logout, a real form control, and safe account navigation without clicking login.

## Automated validation

`npm test`: 102 tests passed. `npx tsc --noEmit` in mobile: passed.

Session tests exercise launch/readiness scheduling, sequential dispatch, search/login-window blocking, background pause, foreground expiry, eight-second deadlines, unavailable pages, stale job/navigation messages, SPA account navigation without load-end, conflicting evidence, persistence validation, Amazon mirroring, Blinkit's phone form, safe submenu inspection, product messages not proving login, and delayed observations after the interactive window opens.

## Sync menu and guest address setup

The home screen now groups the six account controls under one Sync button. Its refresh icon rotates with a native animation while the sequential queue works, and stops while paused or idle. Expanding it opens a scrollable store panel with all six statuses and a manual account refresh action. Settings uses a cog with a 44-point touch target.

The panel saves an optional address search string locally under `lowp_fallback_address_v1`. Signed-out rows offer Set address. Each opens its own store window and fills that store's location search; the user chooses the appropriate suggestion in the store. No suggestion, address ID or selected address is copied between stores. The window supports editing the query and retrying Fill address. Signed-in accounts are not offered automated address setup. A location sheet hiding account cues does not erase a recent validated account observation; explicit new authentication evidence still updates it.

The helper only opens recognized location controls and fills visible address search or delivery PIN fields. It excludes login, OTP and password fields, never submits forms or chooses suggestions, validates reply origin/store/operation token, cancels previous work when the query changes, and falls back to manual instructions by eight seconds. Amazon and Flipkart PIN fields receive only a six-digit PIN extracted from the query. Flipkart's homepage lacks a guest location field, so the helper explains the product-page delivery PIN route. Store-specific support outside the verified cases remains dependent on the store exposing its location selector or allowing guest location setup.

Native Exynos checks verified the collapsed Sync layout, all six expanded rows, native rotation during manual refresh, local address saving, and the Settings cog opening Settings. Both Blinkit and Zepto accepted the test query `Hyderabad 500081` and displayed their own location suggestions. No suggestion was selected; the test query was then cleared from LowP. Flipkart's home page produced its manual PIN-field guidance. Store packs and existing delivery selections were retained.

Validation after these changes: all **109 tests** pass, mobile TypeScript passes, and `git diff --check` passes. Added coverage includes manual re-sync progress and search blocking; address normalization/PIN handling; bridge rejection; no form submission or suggestion selection; safe selector opening; login/OTP field exclusion; signed-in protection; and unavailable-selector fallback. Screenshots: `benchmarks/lowp-sync.png` and `benchmarks/lowp-sync-working.png`.

### Repeated address setup, location status, and scoped website-data clearing

Zepto's selected address uses `data-testid="user-address"` inside a button whose label becomes the address. The helper now clicks that button instead of relying on its initial Select Location label. Flipkart has both desktop delivery Change controls and a mobile product-page address row under Delivery details; both are handled. Address setup remembers the visited product page during this app session. Retrying does not click the location control underneath an already open panel. Pure PIN fields receive a PIN; combined area/street/PIN searches receive the full query.

Set address is available for both Signed out and Unknown. Store sync now reports Location set, Location needed, or Location unknown independently of login, from structured delivery controls. Filled search text never establishes that a location was applied. Probe and interactive location messages validate their store, origin and current operation/navigation token. Account pages with no location cues do not erase a recent validated location; location evidence expires after five minutes. Background location inspection stops with the account probe; interactive inspection stops when its WebView closes.

On the Exynos phone, Zepto's selected-location control reopened its search and Fill address populated the saved query without choosing a suggestion. Its pill showed Signed out and Location set separately. Flipkart's mobile product-page control opened the location panel and its area/street/PIN field was filled in one run. Later repeated openings sometimes rendered the location panel without an editable search field; this remains a store-page limitation and the helper reports it rather than claiming a successful fill. The selected product page was retained across closing and reopening the address window. No location suggestion was selected. The user's saved fallback query and delivery settings were kept. Swiggy's user-initiated sign-out was observed in the sync sheet.

Signed-out stores have Clear cache/cookies, disabled during searches. Opening the action does not clear anything: a separate confirmation explains the scope and removed delivery preferences. It clears current-origin local/session storage, CacheStorage, service-worker registrations, IndexedDB, and accessible cookies at applicable domain/path scopes. It never calls native WebView.clearCache, which clears the shared HTTP cache. **Expo Go cannot remove domain-scoped HttpOnly cookies through the available API; protected cookies may remain**, and both confirmation and result state this. Other store sessions and LowP packs are unaffected. Only the cleared store's parked view and affected in-memory search entries are reset. Clearing was tested with isolated mock site data, not executed against the user's live store cookies/preferences.

Validation: **116 tests pass**, mobile TypeScript passes, and whitespace checks pass. Regression coverage includes selected-address controls, delivery-scoped Change matching, keeping an existing location panel open, combined search versus PIN fields, independent location evidence, stale bridge messages, signed-in reset protection, scoped storage/cookie expiry, and remounting only an explicitly cleared store.

### Store-window simplification and shared phone-login cues

The duplicate green Done control was removed from the store window. Its accessible Close store icon has a 44-point touch target. Clear cache/cookies is now available for Unknown as well as Signed out in both the sync sheet and store data window. Checking and Signed in remain unavailable; the injected reset also refuses an explicitly signed-in page. The confirmation and protected-cookie limitation are retained.

All six stores now recognize exact visible Enter mobile/phone number prompts. A visible editable phone field also establishes Signed out when a visible By continuing, you agree to our terms notice is within its small surrounding container. This supports login screens without a Login heading. Terms notices alone, hidden notices, checkout/delivery-address forms, profile editing fields without login evidence, and Zepto's ambiguous generic home Login button remain insufficient. Conflicting logout and phone-login evidence stays Unknown. The connected phone's interactive Zepto account page reported Signed out after the change.

Clear cache/cookies is also shown during Checking: opening its data window pauses the account queue, and a page classified Signed in still blocks clearing. The sync sheet now has a bounded height and a flexed scroll area so all six stores and refresh remain reachable.

Flipkart address setup now starts from home, not the last product page. The verified mobile address row is an unlabelled href-less link identified by its location-pin SVG rather than generated CSS classes. The helper waits for that row to settle and opens it only once, avoiding retries that can close a panel still loading. Existing desktop/product delivery adapters remain as fallbacks. On the Exynos phone, **two consecutive Set address openings automatically produced the validated “Search filled” result**, without manually tapping the site's address line or LowP's Fill address button. No suggestion was selected; the saved query and selected delivery address were retained. The diagnostic CDP helper now prefers the visible, attached store window over a parked page with the same URL.

Validation: **117 tests pass**, including the Flipkart home-settle/open-once/search-fill regression; TypeScript and whitespace checks pass.

### Protected delivery cookies and Swiggy's two-step location search

Cookie metadata inspection on the Exynos phone confirmed that Swiggy's address, addressId, latitude and longitude cookies are HttpOnly at the root path; Flipkart also has protected session cookies. JavaScript clearing in Expo Go cannot delete those cookies. Values were neither logged nor exported. The Expo Go confirmation and completion message now explicitly say that a saved address may remain and a new native LowP build is required for the complete reset.

A local Android Expo module (`modules/store-site-data`) adds allowlisted store-specific native cookie expiry, including HttpOnly cookies, and origin storage deletion. Amazon.in and Amazon Now share the same reset scope. It does not use global cookie removal or shared HTTP-cache clearing. The cleared store's interactive and parked WebViews unload while native reset runs; other stores remain mounted. Reset completion invalidates the affected account/location observations and cached searches. Native expiry is bounded and returns partial rather than claiming completion if cookies remain. The JavaScript bridge is tested and Expo autolinking resolves the module, but **the Kotlin code has not been compiled or tested on-device**: this PC lacks the Android/JDK toolchain, and Expo Go cannot load this custom module. Live store data was not cleared during validation.

Swiggy address setup now starts from home and targets `data-testid="address-bar"`. Its summary then opens a second `data-testid="search-location"` control before an editable field appears. The helper handles both stages without selecting suggestions. On the Exynos phone, Fill address succeeded, and a subsequent close/reopen through Set address automatically produced **Search filled** without manually touching the store's address bar or LowP's Fill button. The user's saved query was retained and no delivery match was applied.

Location needed is now displayed as **Choose delivery location**: it means a structured delivery control explicitly asks for a location. Location unknown means there is insufficient evidence; neither label indicates login status. Swiggy's structured address-line control now supplies location evidence, including the Select your address empty state.

Validation: **122 tests pass**, mobile TypeScript and whitespace checks pass. New regressions cover the native bridge's unavailable/partial/success outcomes, suspending only the cleared store, Swiggy's two-step search, and independent selected/empty address evidence.
