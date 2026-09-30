# Publishing Kurdish Tank on Google Play

The Android app is a **Trusted Web Activity (TWA)**: a small Android wrapper
that opens your game's website full screen, with no browser bar. Every update
you put on the server reaches players at once, so there is no need to upload a
new app for each change.

## What you need

| Item | Cost | Notes |
|---|---|---|
| Google Play developer account | $25 (done) | Finish identity checks and phone verification in the Play Console |
| Permanent server with HTTPS | about €5/month | e.g. Hetzner CX23 + Docker (see DEPLOY.md). Free hosts that sleep are **not** OK |
| Your own domain (recommended) | about $10/year | e.g. `kurdishtank.com`. The app is tied to this address forever |
| A contact email | free | Shown on the store, privacy and delete pages |
| 12 testers with Android phones | free | New personal accounts must run a closed test: 12+ testers for 14 days |
| Payments profile in a supported country | — | Only needed to sell gems (see "Selling gems" below) |

## Step 1: Put the game on its permanent address

1. Deploy with Docker as in DEPLOY.md, with a disk for `DATA_DIR` and HTTPS.
2. Set these env vars:
   - `CONTACT_EMAIL=you@example.com`
   - `ANDROID_PACKAGE=com.kurdishtank.app` (pick it once; it can never change)
   - `ADMIN_KEY=<long random text>`
   - Leave `PAYMENTS_TEST` **off**.
3. Check that these open on your domain:
   - `https://YOURDOMAIN/`
   - `https://YOURDOMAIN/privacy`
   - `https://YOURDOMAIN/delete-account`
   - `https://YOURDOMAIN/manifest.webmanifest`

## Step 2: Build the Android app with PWABuilder

1. Go to https://www.pwabuilder.com, enter `https://YOURDOMAIN`, and click **Package for stores → Android**.
2. Options:
   - Package ID: `com.kurdishtank.app` (the same as `ANDROID_PACKAGE`)
   - App name: `Kurdish Tank`; launcher name: `Kurdish Tank`
   - Display: fullscreen; orientation: landscape
   - Signing key: **Create new**
   - Play Billing: turn **on** only when you have a merchant account
3. Download the zip. It contains:
   - `app-release-bundle.aab` (upload this to Play)
   - `signing.keystore` and `signing-key-info.txt`: **back these up in 2 safe places.** Without them you cannot update the app.
   - `assetlinks.json`: copy the SHA-256 fingerprint from it.

## Step 3: Link the app and the website (removes the browser bar)

The site must list **two** fingerprints:

- **Upload key:** from PWABuilder's `assetlinks.json`.
- **App signing key:** in Play Console → your app → Test and release → App integrity → App signing, copy the "SHA-256 certificate fingerprint".

Set both, comma separated, then restart the server:

```
ANDROID_SHA256=AA:BB:...:11,CC:DD:...:22
```

Check `https://YOURDOMAIN/.well-known/assetlinks.json`. If the phone app shows
a browser address bar at the top, this step is wrong.

## Step 4: Create the app in Play Console

1. **Create app:** name `Kurdish Tank`, default language English (or Arabic), Game, Free.
2. **App content** (answers below):
   - Privacy policy: `https://YOURDOMAIN/privacy`
   - Ads: No
   - App access: all features work without special login (players pick a name)
   - Content rating, Target audience, Data safety, Account deletion
3. **Store listing:** texts, icon, feature graphic, screenshots (see below).

## Step 5: Closed test for 14 days

1. Go to Test and release → Testing → **Closed testing** and create a track.
2. Upload the `.aab`.
3. Add at least **12 testers' Gmail addresses** (friends and family).
4. Send them the opt-in link. They must **stay opted in for 14 days** and open the game a few times.
5. After 14 days: Dashboard → **Apply for production** and answer the questions about the test.

## Step 6: Production

Once approved: Production → Create release → upload the same `.aab` → Countries: all (or pick) → Roll out.
Review usually takes a few days.

---

## Store listing texts

Kurdish (Sorani) is not a Play Store listing language, so use **English** and
**Arabic** listings and put Kurdish text inside the descriptions.

### English (en-US)

**App name (30 max):** `Kurdish Tank`

**Short description (80 max):**
`Fast 3D tank battles in Hawler, desert and forest. Play with friends online!`

**Full description:**

```
تانکی کوردی — شەڕی تانک لەگەڵ هاوڕێکانت!

Kurdish Tank is a fast, colorful online tank battle game.

• Battle on the Hawler map, in the desert and in the forest
• Ranked 4v4 matches on a random mode and map — climb from Bronze to Legend
• 8 tanks to unlock and upgrade: Zagros, Baz, Halgurd, Bradost, Korek, Newroz and more
• Private rooms: play with your friends with a room code
• Friends list and chat
• Daily rewards, lucky wheel, chests and quests
• Power-ups: repair, shield, speed and more
• Kurdish, Arabic and English
• Works on phones and tablets with simple touch controls
• Practice mode works offline

یاری بکە لە هەولێر، بیابان و دارستان. پلەکەت بەرز بکەرەوە و تانکە نوێیەکان بکەرەوە!
```

### Arabic (ar)

**App name:** `الدبابة الكردية - Kurdish Tank`

**Short description:**
`معارك دبابات ثلاثية الأبعاد في هولير والصحراء والغابة. العب مع أصدقائك!`

**Full description:**

```
الدبابة الكردية — لعبة معارك دبابات سريعة وملونة عبر الإنترنت.

• قاتل في خريطة هولير والصحراء والغابة
• مباريات مصنّفة 4 ضد 4 — اصعد من البرونز إلى الأسطورة
• 8 دبابات لفتحها وتطويرها
• غرف خاصة للعب مع أصدقائك برمز الغرفة
• قائمة أصدقاء ودردشة
• مكافآت يومية وعجلة الحظ وصناديق ومهام
• تقويات: إصلاح، درع، سرعة والمزيد
• باللغات الكردية والعربية والإنجليزية
• وضع التدريب يعمل بدون إنترنت

تانکی کوردی — شەڕی تانک لەگەڵ هاوڕێکانت!
```

### Graphics

| Asset | Size | File |
|---|---|---|
| App icon | 512×512 PNG | `store/app-icon-512.png` |
| Feature graphic | 1024×500 | `store/feature-graphic-1024x500.png` |
| Phone screenshots | 2–8, landscape 16:9 | Take them on a real phone in the finished app (menu, battle, garage, shop, ranked) |

---

## Answers for the Play Console forms

### Data safety

- **Does the app collect or share user data?** Yes, it collects; it does **not share** with third parties.
- **Is data encrypted in transit?** Yes (HTTPS / WSS).
- **Can users request deletion?** Yes: in the game (Settings → Delete account) and at `https://YOURDOMAIN/delete-account`.

| Data type | Collected | Why | Optional? |
|---|---|---|---|
| Personal info → **Name** (player name) | Yes | App functionality, account management | Required |
| Personal info → **User IDs** (Name#1234 ID) | Yes | App functionality, account management | Required |
| Messages → **Other in-app messages** (friend chat) | Yes | App functionality | Optional |
| App activity → **Other actions** (matches, stats, rank) | Yes | App functionality | Required |
| Financial info → **Purchase history** | Only if you sell gems | App functionality | Optional |
| App info and performance → **Crash logs / diagnostics** | No | — | — |

No location, contacts, photos, or advertising ID are collected.

### Content rating (IARC questionnaire)

- Category: Game
- Violence: **cartoon/fantasy violence** against vehicles, no blood, no people hurt
- Users can interact / communicate: **Yes** (friend chat; has word filter, block and report)
- Shares user location: No
- Digital purchases: **Yes**, if gems are sold
- Random items bought with money (chests): answer **Yes** if chests can be bought with gems that were bought with money
- Gambling with real money: No

Expected result: roughly PEGI 7 / Everyone 10+.

### Target audience

Choose **13–15, 16–17, 18+**. Do not select under 13 (children's apps have extra rules for chat and purchases).

### Account deletion

- Deletion URL: `https://YOURDOMAIN/delete-account`
- In-app: Settings → Delete my account

---

## Selling gems (real money)

Google Play lets developers in **Iraq** publish apps, but **not** sell things
(merchant accounts are not supported there). Your options:

1. **Launch free now (recommended).**
   - The gem shop hides itself automatically when no payment system is set up.
   - Players still earn gems from daily rewards, quests, the wheel and chests.
2. **Sell later** through a payments profile in a supported country where you or your business has a real address and bank account (for example Turkey, the UAE or Jordan). Then:
   1. Create in-app products in Play Console with these IDs: `gems_80`, `gems_500`, `gems_1200`, `gems_2600`, `gems_7000`, `starter_pack`.
   2. Create a Google Cloud service account with access to the Play Android Developer API, and invite it in Play Console → Users and permissions (financial data permission).
   3. Set `PLAY_PACKAGE` and `GOOGLE_SERVICE_ACCOUNT` on the server.
   4. Rebuild with PWABuilder with Play Billing **on**, using the **same signing key**, and upload it as a new version.

## Common reasons TWA apps are rejected

- Browser bar visible → the fingerprints in Step 3 are wrong.
- "Minimum functionality" → the app must do more than show a website. This app has offline practice and a full game, which is fine. Keep the server always on.
- Privacy policy or deletion link not opening → check Step 1.
- Closed test testers not active for 14 days.
