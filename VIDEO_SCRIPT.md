# Demo video — shot list

**Target: 1 min 45. Silent screen capture, English text on top.** Judging is often
primarily the video, so it has to show the real product and the real chain, not slides.

Record with `Cmd + Shift + 5` → *Record Selected Portion* → draw a box around the browser
window only → **Record**. Stop from the menu bar. Nothing else to install.

Before you start: close other tabs, hide bookmarks (`Cmd + Shift + B`), set the browser to
full screen, and **turn Chrome translation off on both sites**.

---

## 0:00 – 0:10 · Hook

**Open:** https://curvature-dbc.vercel.app

**Do:** grab one of the square handles on the trace and drag it slowly up, then down. Let
the readouts recompute twice. Do not rush — this is the shot that sells the product.

**Text on screen:**
> A bonding curve is a waveform.
> This is the instrument you tune it on.

---

## 0:10 – 0:28 · The thing no other tool shows

**Do:** click the preset **`long`**. Hold still on the liquidity strip at the top.

Point the cursor at the first four bands — they are slivers.

**Text on screen:**
> Meteora's DBC spreads a launch over up to 16 liquidity points.
> This curve uses 6. Four of them are dead:
> 92% of the raise happens in the last two.

---

## 0:28 – 0:42 · Fix it live

**Do:** drag the 2nd, 3rd and 4th price handles apart from each other. The bands widen as
you pull. Let the `graduation` readout change on camera.

**Text on screen:**
> Widen the price bands and the dead segments come alive.
> Every number recomputes offline — no RPC, no wallet, no SOL.

---

## 0:42 – 0:58 · Price it in a stock

**Do:** click **`quote: SOL`**. Type `NVDA`. Pick **NVDAx**. Let the panel show
`8 · confirmed` next to *quote decimals*.

**Text on screen:**
> Meteora shipped stock tokens as a DBC quote mint on 9 September.
> 2366 badged mints: xStocks, Ondo, Backpack.
> The decimals are read from the chain, never assumed.

---

## 0:58 – 1:12 · The gate

**Do:** scroll down to the launch panel. Hover over the quote mint address and the fee
schedule so both are readable.

**Text on screen:**
> A curve can be legal on chain and still be a trap.
> Fees, decimals, graduation threshold — all checked before anything is signed.

---

## 1:12 – 1:30 · Proof, on mainnet

**Open:** https://solscan.io/address/FciaqVNGbBAbQ36eXwpE9gHdtwr4Dt2GaLoxTtg8gDBW

**Do:** let the page load. Scroll once so the account and its owner program are visible.

**Text on screen:**
> Live on Solana mainnet, not devnet.
> A token priced in NVIDIA's tokenized share.
> FciaqVNGbBAbQ36eXwpE9gHdtwr4Dt2GaLoxTtg8gDBW

---

## 1:30 – 1:45 · Close

**Open:** https://github.com/SALI-546/curvature-dbc — scroll to the measured tables.

**Text on screen:**
> createConfig 0.00598408 SOL. createPool 0.02059164 SOL.
> createConfigAndPool breaks past 1232 bytes at 9 curve points.
> Measured against the chain, not modelled. Every script ships.
>
> curvature-dbc.vercel.app
> github.com/SALI-546/curvature-dbc

---

## Subtitles

Fastest path is **CapCut**: drop the clip in, *Text → Auto captions* is useless on a silent
clip, so use *Text → Add text* and paste each block above at its timecode. Keep the font
white, bottom third, with a dark box behind it.

If you would rather burn them in from a file, write `captions.srt` with the same timecodes
and run:

```
ffmpeg -i raw.mov -vf "subtitles=captions.srt:force_style='FontSize=22,PrimaryColour=&Hffffff&,BackColour=&H80000000&,BorderStyle=4'" -c:a copy demo.mp4
```

To trim dead air at the start or end:

```
ffmpeg -i raw.mov -ss 00:00:03 -to 00:01:48 -c copy demo.mp4
```

## Before you submit

- Play it back once, muted, and read only the text. If a stranger cannot follow it, fix it.
- Check the file is under the submission's size limit and plays in a browser.
- Verify https://curvature-dbc.vercel.app still answers, right before you submit.
