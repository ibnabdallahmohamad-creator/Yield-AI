# Harvestar AI fine-tuning dataset (Unsloth)

A chat-format dataset for fine-tuning a small open model with [Unsloth](https://unsloth.ai) into Harvestar AI's
Qatar farm advisor. Every example is one `system` / `user` / `assistant` conversation:

- **user**: the question on the first line, tagged **`Q1:`** (land suitability) or **`Q2:`** (an inquiry
  about a farm that is already growing), then a blank line and the input as one line of JSON: the
  **nine inputs**, the farmer's context, values code derived from the inputs, and dated evidence (news,
  research, datasets) with ids.
- **assistant**: one JSON object with the **same ten keys in the same order every time**.

```text
Q1: Which crop should I grow here, and should it be a greenhouse, hydroponics or the open field?

{"task":"land_analysis","as_of":"2026-03-10 08:30","forecast_days":[...],"inputs":{"latitude":25.35,...},"context":{...},"derived":{...},"evidence":[...]}
```

There are two tasks, split 50/50:

| Tag | Task | Question it answers | Example questions |
|---|---|---|---|
| **Q1** | `land_analysis` | Is this land suitable, and what should this land be used for: which crop, in what type of farm? It weighs the site, its water, the market, trade and politics, and the national food-security goals. | "What is the best use for this land?", "Which crop should I grow here, and should it be a greenhouse, hydroponics or the open field?", "With the trade situation and the national food goals, what's the smartest product for this plot?", "Is a fish farm a good idea on this 8 ha plot?" |
| **Q2** | `farm_analysis` | How is the growing crop doing today, and what should the farmer do now? | "Should I irrigate today, and how much?", "Is the weather this week a problem for my tomato?", "What will this cucumber crop earn, and when do I harvest?", "What should I plant after this zucchini?" |

## Files

| File | In git | What it is |
|---|---|---|
| `unsloth/harvestar-ai-qatar.jsonl` | no (66 MB, regenerate) | **The whole dataset in one file**: 3,000 conversations, Q1 and Q2 interleaved |
| `unsloth/README.md` | yes | Hugging Face dataset card, so the `unsloth/` folder can be uploaded to the Hub as it is |
| `unsloth/sample.jsonl` | yes | 4 examples (2 per task) to read |
| `unsloth/stats.json` | yes | Counts by task, focus, crop, system, water source, top land use and warning severity |
| `qatar-site-grid.json` | yes | The location inputs per 0.1° cell over Qatar, extracted from `Datasets/` |
| `qatar-production.json` | yes | FAOSTAT value of production for Qatar (constant 2014–2016 US$) |
| `cache/weather/*.json` | no | Daily weather per site from the Open-Meteo archive (29 sites, Jan 2023 to Sep 2026) |

Each JSONL line is `{"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}`,
the conversational format that 🤗 `datasets`, TRL and Unsloth read directly. The user turn is built by
`formatUserMessage` in `lib/dataset/schema.ts`; use the same function at inference.

Checked with `datasets` 5.0.1 and the Qwen3 tokenizer: `load_dataset("json", ...)` gives 3,000 rows with a
single `messages` column; every row is system → user → assistant; every land row starts with `Q1:` and
every farm row with `Q2:`.

## The nine inputs (`user.inputs`, always in this order)

| # | Key | What it holds | Training data | Live app |
|---|---|---|---|---|
| 1 | `latitude` | Decimal degrees | Random point in one of 29 sites across Qatar's land | The farm or plot the user picks on the map |
| 2 | `longitude` | Decimal degrees | Same as 1 | Same as 1 |
| 3 | `ecosystem` | Ecosystem type, place and municipality, distance to the coast; aridity index and class; farming system; 1991–2020 climate normals (hottest and coldest month, rain, its year-to-year variation, ET₀, water deficit, wet days); climate trend 1979–2026 (summer highs per decade, ET₀ per decade); soil texture, root-zone water and rooting depth; irrigation share and groundwater share; groundwater basin and its typical salinity | FAO AQUAMAPS rasters (aridity, CRU rain, AQUASTAT ET₀, SOLAW farming systems, GMIA v5 irrigation, salinized land, HWSD soil water, rooting depth, wet days) and AgERA5 monthly climate, all from `Datasets/` via `scripts/dataset/extract_site_grid.py` | Same grid, nearest cell (`lib/dataset/site.ts`) |
| 4 | `growable_crops` | 17 crops rated on the local groundwater: suitability (good, marginal, protected only, not with this water), relative yield under FAO-29 salinity, open-field planting months, whether it survives summer outdoors, farm types | FAO-29 salt tolerance (Maas–Hoffman) at the basin's typical ECw, plus the site's summer highs (`lib/dataset/crops.ts`) | Same |
| 5 | `air_temperature` | Today's max and min, the past 7 days' mean max, the next 7 days' max and min | Open-Meteo **historical archive (ERA5)**, real measured days | Open-Meteo **forecast** API (`FORECAST_URL`) |
| 6 | `relative_humidity` | Today's max and min, next 7 days | Same as 5 | Same as 5 |
| 7 | `wind` | Today's mean, max and direction, next 7 days (m/s) | Same as 5 | Same as 5 |
| 8 | `rain` | Today, past 7 days, past 30 days, next 7 days (mm) | Same as 5 | Same as 5 |
| 9 | `soil_moisture` | Field-robot probe survey at 0–30 cm: mean, min and max volumetric water %, number of readings, 7-day change; or a note that the robot hasn't surveyed | **Simulated**: a daily FAO-56 root-zone water balance on the real weather with a random irrigation habit, sampled like the robot (8–24 readings with spread). About 10% of farm and 40% of land examples have no survey, so the model learns to say so. | The robot's readings |

Next to the inputs, `context` holds what the farmer tells the app (area, water source and EC, budget, and
for land, what kind of farm they want). `derived` holds everything code computes from the inputs, so the
model never has to do arithmetic: FAO-56 crop water use, depletion and the irrigation plan, root-zone
salinity and relative yield, the 8 land uses scored by the app's own ranking (`lib/land/score.ts`), national
goals and gaps, the market now, FAOSTAT values and economics. `evidence` lists the sources the answer may cite.

## The output (`assistant`, always these keys in this order)

Each key is one **section of the page**, with a fixed shape. Every string is one line of plain text
(no Markdown, bullets or line breaks), so the website places each section as it is.

```jsonc
{
  "task": "land_analysis | farm_analysis",
  "summary": "The direct answer in 2–3 sentences.",
  "insights": [{ "title": "", "detail": "", "sources": ["N5", "D2"] }],                                  // 2–6
  "warnings": [{ "severity": "critical | warning | watch", "title": "", "when": "Thu 25 – Sat 27 Sep", "detail": "", "action": "" }], // 0–5
  "forecast": {
    "next_7_days": "",
    "days": [{ "date": "2026-09-25", "label": "Irrigate 25.1 mm, hot 41 °C", "level": "ok | watch | warning" }], // exactly 7
    "season_ahead": "",
    "long_term": ""
  },
  "economic_advice": { "summary": "", "figures": [{ "label": "", "value": "", "basis": "" }], "advice": [""] },
  "recommendations": [{ "priority": "high | medium | low", "action": "", "when": "", "why": "" }],           // 2–6
  "crop_plan": {
    "recommended": [{ "crop": "", "farm_type": "", "when": "From Sep | Plant Oct–Nov | Now", "why": "" }],   // 1–3, first = the choice
    "avoid": [{ "crop": "", "why": "" }],
    "harvest": { "status": "establishing | growing | harvesting | ending | cutting", "start": "2026-10-02", "end": "2026-12-20" } // null for Q1
  },
  "sources": [{ "id": "", "title": "", "url": "" }],
  "data_gaps": [""]
}
```

The zod schema is `ModelOutputSchema` in `lib/dataset/schema.ts`. The system prompt (`SYSTEM_PROMPT`, same
file) is identical in training and inference.

## Website sections (no second model needed)

`lib/ai/model-output.ts` takes a reply apart with plain code:

| Function | What it does |
|---|---|
| `parseModelReply(reply)` | Finds the JSON in the raw reply (ignores a ```` ```json ```` fence, an empty `<think></think>` block or stray text), validates every section, and returns `{ ok, answer }` or `{ ok: false, error }` |
| `toFarmReport(answer)` | A Q2 answer as the Insights page's `FarmReport` (`lib/ai/contract.ts`), which `components/insights/report-sections.tsx` already renders |
| `insightFromModelReply(reply, row)` | Raw reply → a stored `ai_insights` row, or null if the reply is unusable (the page then falls back to the rules) |
| `toLandResearch(answer, meta)` | A Q1 answer as the land planner's research panel (`LandResearch`, `lib/land/contract.ts`) |
| `SECTION_LAYOUT` | Where each section goes, in reading order |

| Section | Heading | Farm page (Q2) | Land page (Q1) |
|---|---|---|---|
| `summary` | Answer | Report summary | Research headline |
| `warnings` | Warnings | Warnings card; `when` beside the title; the worst severity sets the risk badge | Highlights marked as risks |
| `insights` | Insights | Insights card | Highlights, with their source links |
| `recommendations` | What to do | Recommendations, by priority | Part of the advice paragraph |
| `forecast` | Next 7 days | Forecast card: `days` as the seven day chips, `next_7_days` as its summary; `season_ahead` is the harvest summary | Seven day chips |
| `economic_advice` | Economic analysis | Economics card: summary + advice, `figures` as label/value rows | Part of the advice paragraph |
| `crop_plan` | Crop plan | Crop suggestion (first item), Harvest card (`harvest` window, alternatives as next crops) | The first item leads the advice |
| `data_gaps` | Data gaps | Economics "Assumptions" | Caveats |
| `sources` | Sources | — | Source links |

The build runs every one of the 3,000 answers through `parseModelReply` and the matching adapter, and
the tests check that `insightFromModelReply` output passes the site's own `parseInsight`.

## What every example is checked for

`scripts/dataset/build-dataset.ts` runs `checkExample` (`lib/dataset/grounding.ts`) on every example and
fails the build if more than 2% fail. The full build has 0 failures.

- The output matches the schema, with the keys in order; all nine inputs are present, in order.
- Every cited id is in the evidence, and `sources` lists it with the evidence's exact title and URL.
- **Every number in the answer appears in the input.** Only counts 0–12 and years are exempt, so the
  model is never trained to invent a price, a date or a statistic. Every YYYY-MM-DD date in the answer
  must be in the input as well.
- **Qatar only:** every site is inside Qatar's outline (`isInQatar`), and no answer names another country
  or region. Source titles are exempt because they are quoted exactly.
- **Ready for the page:** every string is one line of plain text, `forecast.days` has one entry per
  forecast day, and the answer goes through `parseModelReply` and `toFarmReport` / `toLandResearch`
  without an error.
- **No evidence from the future:** an item only appears in examples dated on or after its publication.
  Before 17 Sep 2026, for example, the model can't know about the new import tariffs.
- Land examples start on 25 Aug 2025, the date of the national-goal figures they use. Farm examples run
  from Aug 2023 to Sep 2026.

## Numbers (full build, seed 7)

| | |
|---|---|
| Examples | 3,000 in one file: 1,500 Q1 (land) and 1,500 Q2 (farm) |
| Sites | 29 |
| Water | groundwater 1,764, desalinated 846, TSE 390 |
| Farm crops | tomato 349, cucumber 290, alfalfa 237, zucchini 227, sweet pepper 199, eggplant 198 |
| Growing systems | cooled greenhouse 722, open field 444, net house 334 |
| Land: owner's interest | open to anything 808, crops 463, fish 122, livestock 107 |
| Land: best use | sheep and goats 424, leafy greens (hydroponic) 365, table eggs 327, fodder on TSE 139, open-field vegetables 111, fish 99, dates 20, greenhouse vegetables 15 |
| Warnings | 300 critical, 2,671 warning, 3,843 watch |
| Where | 7 municipalities: Al Wakrah 816, Al Sheehaniya 778, Al Shamal 471, Al Khor 397, Al Rayyan 280, Al Daayen 148, Umm Salal 110; none outside Qatar |
| Length | user ≈ 12.6K characters (max 17.5K), assistant ≈ 6.5K (max 9.6K); Qwen3 tokens per conversation, including the chat template: mean 6,702, 99th percentile 8,748, max 8,894 |

The best use follows the app's ranking. Most of Qatar's well water is too salty for greenhouse vegetables,
and eggs and red meat have the biggest gaps to the 2030 targets, so livestock often wins. Greenhouse
vegetables still show up as a recommended option in many answers.

## Sources

The evidence library is `lib/dataset/sources.ts`. Each item carries the facts used, its date, and the date
from which examples may show it. Every fact is about Qatar. The FAO report on the 2026 conflict (R1)
covers the whole region, so only what it means for Qatar is used: Hormuz is the only sea route to
Qatar's ports, Qatar imports most of its food, and fertiliser prices rose.

| Id | Kind | Publisher | Title | Date |
|---|---|---|---|---|
| N1 | news | The Peninsula | [Qatar's local vegetable production to reach 120,000 tonnes by end of 2026, achieving 70% self-sufficiency](https://thepeninsulaqatar.com/article/26/03/2026/qatars-local-vegetable-production-to-reach-120000-tonnes-by-end-of-2026-achieving-70-self-sufficiency) | 2026-03-26 |
| N2 | news | The Peninsula | [Qatar advances food self-sufficiency with strong growth in local production](https://thepeninsulaqatar.com/article/22/03/2026/qatar-advances-food-self-sufficiency-with-strong-growth-in-local-production) | 2026-03-22 |
| N3 | news | The Peninsula | [45 livestock production projects drive Qatar's food security goals](http://thepeninsulaqatar.com/article/03/06/2026/45-livestock-production-projects-drive-qatars-food-security-goals) | 2026-06-03 |
| N4 | news | The Peninsula | [Qatar has achieved full self-sufficiency in dairy and fresh poultry: Official](https://thepeninsulaqatar.com/article/05/06/2025/qatar-has-achieved-full-self-sufficiency-in-dairy-and-fresh-poultry-official) | 2025-06-05 |
| N5 | government | Qatar News Agency | [Qatar's food security: significant efforts in local production expansion, pivotal role for private sector](https://qna.org.qa/en/news/news-details?id=qatars-food-security-significant-efforts-in-local-production-expansion-pivotal-role-for-private-sector-1&date=25/08/2025) | 2025-08-25 |
| N6 | news | The Peninsula | [Customs tariff raised on chicken, some vegetables in Qatar: Official Gazette](http://thepeninsulaqatar.com/article/17/09/2026/customs-duty-raised-on-chicken-some-vegetables-in-qatar-official-gazette) | 2026-09-17 |
| N7 | news | The Peninsula | [Qatar Customs clarifies exemptions from increased poultry, vegetable tariffs](http://thepeninsulaqatar.com/article/24/09/2026/qatar-customs-clarifies-exemptions-from-increased-poultry-vegetable-tariffs) | 2026-09-24 |
| N8 | news | The Peninsula | [Qatar develops integrated food security system with strategic grain reserve](https://thepeninsulaqatar.com/article/15/03/2026/qatar-develops-integrated-food-security-system-with-strategic-grain-reserve) | 2026-03-15 |
| N9 | news | The Peninsula / QNA | [Qatar reaps benefits of diversification in food security, crisis resilience](https://thepeninsulaqatar.com/article/06/04/2026/qatar-reaps-benefits-of-diversification-in-food-security-crisis-resilience) | 2026-04-06 |
| N10 | news | The Peninsula | [Ministry of Municipality starts providing support to farmers for new crop season](http://thepeninsulaqatar.com/article/04/09/2024/ministry-of-municipality-starts-providing-support-to-farmers-for-new-crop-season) | 2024-09-04 |
| N11 | news | Gulf Times | [Smart farms seen as key to next phase of food security](https://www.gulf-times.com/article/732856/qatar/smart-farms-seen-as-key-to-next-phase-of-food-security) | 2026 |
| N12 | news | Qatar News Agency | [Holy Month of Ramadan boosts demand for Qatari dates as national production reaches 24,000 tons in 2025](https://qna.org.qa/en/news/news-details?id=holy-month-of-ramadan-boosts-demand-for-qatari-dates-as-national-production-reaches-24000-tons-in-2025&date=19%2F02%2F2026) | 2026-02-19 |
| N13 | news | The Peninsula | [10th Local Dates Festival concludes with over 90,000 visitors](http://thepeninsulaqatar.com/article/08/08/2025/10th-local-dates-festival-concludes-with-over-90000-visitors) | 2025-08-08 |
| N14 | news | FreshPlaza | [Vegetable prices up in Qatar due to constrained local production](https://www.freshplaza.com/asia/article/9642425/) | 2024-07-08 |
| N15 | news | The Peninsula | [Local vegetable production exceeds consumption: official](https://thepeninsulaqatar.com/article/23/01/2023/local-vegetable-production-exceeds-consumption-official) | 2023-01-23 |
| N16 | news | Euronews | [Planting the seeds of change: Qatar's Food Security Strategy](https://www.euronews.com/2026/07/08/planting-the-seeds-of-change-qatars-food-security-strategy) | 2026-07-08 |
| N17 | news | Fast Company Middle East | [Qatar to slash water use in agriculture by 40% by 2030](https://fastcompanyme.com/news/qatar-to-slash-water-use-in-agriculture-by-40-by-2030/) | 2025 |
| R1 | report | FAO | [Global Agrifood Implications of the 2026 Conflict in the Middle East](https://www.fao.org/agrifood-economics/publications/detail/en/c/1758065/) | 2026-03 |
| R2 | paper | Sustainability 13(7):4059, Karanisa et al. | [Agricultural Production in Qatar's Hot Arid Climate](https://doi.org/10.3390/su13074059) | 2021 |
| R3 | paper | Smart Agricultural Technology (HBKU) | [Economic assessment of greenhouse and vertical farm production systems in arid regions: a case study of Qatar](https://www.sciencedirect.com/science/article/pii/S2772801325000181) | 2025 |
| R4 | paper | Frontiers in Sustainable Food Systems | [From crisis to resilience: food security policy development in Qatar](https://www.frontiersin.org/journals/sustainable-food-systems/articles/10.3389/fsufs.2025.1446264/full) | 2025 |
| R5 | paper | Groundwater for Sustainable Development, Baalousha et al. | [Approaches to achieve sustainable use and management of groundwater resources in Qatar: A review](https://www.sciencedirect.com/science/article/abs/pii/S2352801X19304321) | 2019 |
| R6 | paper | Groundwater, Shomar | [Groundwater Contamination in Arid Coastal Areas: Qatar as a Case Study](https://ngwa.onlinelibrary.wiley.com/doi/10.1111/gwat.13411) | 2024 |
| R7 | paper | Desalination and Water Treatment | [Evaluation of the current state and perspective of wastewater treatment and reuse in Qatar](https://www.sciencedirect.com/science/article/pii/S1944398624147467) | 2024 |
| R8 | paper | Scientific Reports | [Large and regional-scale processes influencing Heat Waves: Insights from Qatar](https://www.nature.com/articles/s41598-026-54666-y) | 2026 |
| R9 | government | HBKU QEERI | [Hydroponics and Aquaponics with AIoT in Qatar (HAIAT)](https://elmi.hbku.edu.qa/en/projects/hydroponics-and-aquaponics-with-aiot-in-qatar-haiat/) | 2025 |
| R10 | government | Qatar News Agency | [Head of Aquatic Research Center: Qatar achieved aquaculture successes in contribution to food security](https://www.qna.org.qa/en/News-Area/News/2023-02/05/0024-head-of-aquatic-research-center-to-qna-qatar-achieved-aquaculture-successes-in-contribution-to-food-security) | 2023-02-05 |
| D1 | dataset | FAO AQUASTAT / AQUAMAPS | [Aridity, farming systems, GMIA v5, salinized land, HWSD soil water](https://data.apps.fao.org/aquamaps/) (CC-BY-4.0) | 2026 |
| D2 | dataset | Copernicus C3S / FAO | [AgERA5 1979–2026](https://doi.org/10.24381/cds.6c68c9bb) (Copernicus licence) | 2026 |
| D3 | dataset | FAOSTAT | [Value of Agricultural Production (QV), Qatar](https://www.fao.org/faostat/en/#data/QV) (CC-BY-4.0) | 2026 |
| D4 | dataset | Open-Meteo | [Forecast and historical weather (ERA5) APIs](https://open-meteo.com/) (CC-BY-4.0) | 2026 |
| M1 | method | FAO | [Irrigation and Drainage Paper 56: Crop evapotranspiration](https://www.fao.org/4/x0490e/x0490e00.htm) | 1998 |
| M2 | method | FAO | [Irrigation and Drainage Paper 29: Water quality for agriculture](https://www.fao.org/4/t0234e/t0234e00.htm) | 1985 |

When you publish the dataset or a model trained on it, credit FAO (AQUAMAPS, FAOSTAT), Copernicus (AgERA5,
"Contains modified Copernicus Climate Change Service information") and Open-Meteo (CC-BY-4.0).
The news items are cited and paraphrased as short facts; their full text is not included.

## Regenerate

```bash
# 1. Location inputs from the FAO downloads in Datasets/ (only if they change; outputs are in git)
python -m venv .venv-geo && .venv-geo/Scripts/pip install numpy rasterio
.venv-geo/Scripts/python scripts/dataset/extract_site_grid.py

# 2. Real daily weather for the sites (Open-Meteo archive, free, no key; ~6 minutes, resumable)
npm run dataset:weather

# 3. Build and check the examples (deterministic for a given seed)
npm run dataset:build -- --land 1500 --farm 1500 --seed 7

# Tests for the builders (synthetic weather; don't need steps 1–2)
npx vitest run lib/dataset
```

To add a news item or paper, add it to `LIBRARY` in `lib/dataset/sources.ts` with its facts and
`available_from` date, map it to the options or crops it supports in the builders, and rebuild.

## Fine-tune with Unsloth

A 4B instruct model is enough for this fixed-format task and runs on the farm's server or a laptop GPU.
The example below uses Qwen3-4B-Instruct-2507; a newer small Qwen from the Unsloth hub works the same way.
If an argument has been renamed in your Unsloth or TRL version, follow Unsloth's current Qwen3 notebook.

**Get the file to the training machine** in any of three ways:

- Copy `data/dataset/unsloth/harvestar-ai-qatar.jsonl` (for example, upload it to Colab).
- Put it on the Hugging Face Hub, then load it by name:
  `hf upload your-name/harvestar-ai-qatar data/dataset/unsloth . --repo-type dataset --private`.
  The folder's `README.md` is the dataset card and points the Hub at the JSONL.
- Load it from any direct URL with `data_files="https://…/harvestar-ai-qatar.jsonl"`.

```python
from datasets import load_dataset
from trl import SFTConfig, SFTTrainer
from unsloth import FastLanguageModel
from unsloth.chat_templates import train_on_responses_only

MAX_LEN = 9216  # the longest conversation is 8,894 Qwen3 tokens

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen3-4B-Instruct-2507",
    max_seq_length=MAX_LEN,
    load_in_4bit=True,  # QLoRA
)
model = FastLanguageModel.get_peft_model(
    model,
    r=32,
    lora_alpha=32,
    lora_dropout=0,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth",
    random_state=3407,
)

ds = load_dataset("json", data_files="harvestar-ai-qatar.jsonl", split="train")
# or: ds = load_dataset("your-name/harvestar-ai-qatar", split="train")
ds = ds.train_test_split(test_size=0.05, seed=3407)
# The model's own chat template; the messages are already system / user / assistant.
ds = ds.map(lambda b: {"text": [tokenizer.apply_chat_template(m, tokenize=False) for m in b["messages"]]}, batched=True)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=ds["train"],
    eval_dataset=ds["test"],
    args=SFTConfig(
        dataset_text_field="text",
        max_length=MAX_LEN,  # max_seq_length in older TRL versions
        per_device_train_batch_size=1,
        gradient_accumulation_steps=8,
        num_train_epochs=2,
        learning_rate=2e-4,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        logging_steps=10,
        eval_strategy="steps",
        eval_steps=100,
        output_dir="outputs",
    ),
)
# Learn only the answers, not the long inputs.
trainer = train_on_responses_only(trainer, instruction_part="<|im_start|>user\n", response_part="<|im_start|>assistant\n")
trainer.train()
model.save_pretrained_gguf("harvestar-ai-4b", tokenizer, quantization_method="q4_k_m")  # for llama.cpp / Ollama
```

At inference, send the same `SYSTEM_PROMPT`, and build the user turn with `formatUserMessage`
(`Q1:` or `Q2:` plus the question, a blank line, then the input JSON). Build the weather window from
the Open-Meteo forecast API (`past_days=30`, `forecast_days=8`) instead of the archive, and soil
moisture from the robot. Use temperature 0 or close to it. Then:

1. Run `parseModelReply(reply)` and hand the result to `toFarmReport` (Q2) or `toLandResearch` (Q1).
   Each section then goes to its place on the page (see **Website sections** above).
2. Run `checkExample(input, answer)` to catch any number or date the model made up, or an answer about
   somewhere other than Qatar.
3. If either step fails, show the app's rule-based report instead.

## Limits

- The answers were written by code (templates over the app's agronomy, ranking and market tables), not by
  agronomists. The dataset teaches the format, the reasoning order and grounding. The quality of the advice
  is only as good as `lib/agronomy*`, `lib/land/*` and `lib/qatar/market.ts`.
- Training weather is the ERA5 archive, so the "next 7 days" in training are what actually happened, a
  perfect forecast. Live forecasts will be less certain.
- Soil moisture is simulated until the robot has a season of real readings; mix those in when they exist.
- Prices, yields and set-up costs are indicative planning ranges. The evidence library is a snapshot as of
  24 Sep 2026 and needs new items as the news moves.
