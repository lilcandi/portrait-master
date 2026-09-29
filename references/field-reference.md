# 字段与枚举参考（实测值域）

来源：本机 `classify.jsonl`（3,389 帧）与关联文件的**实际统计**，非文档推测。

> **铁律：用前先复核。** 换相册后值域可能不同。复核命令见每节末尾。

---

## 1. `classify.jsonl` —— 阶段 1 分类输出

每帧一行 JSON。全部键（实测 `3389` 行）：

```
angle, body_lean, breast_outline_readable, camera_distance, chest_region_obstruction,
chest_region_visible, confidence, file, frame_coverage, measurable, note,
outerwear, person_count, photo_type, tight_fit
```

**注意：没有任何键名匹配 `face`。** 全语料扫过，匹配数为 0。这是本数据集的硬限制——任何「面部」维度只能用取景字段代理，且必须在报告中声明为代理。

### 值域实测

| 字段 | 值域（计数降序） |
| --- | --- |
| `person_count` | 1=**2864**, 0=146, 2=134, 3=64, 4=34, 8=23, 5=20, 6=17, 7=17, 10=13, 12=8, 20=7 …（长尾到 100） |
| `photo_type` | full_body=**1860**, half_body=662, portrait=582, scenery=175, object=57, other=26, detail=18, food=9 |
| `angle` | front=**1794**, three_quarter=1244, unknown=182, top_down=79, back=54, side=36 |
| `camera_distance` | medium=**3018**, far=217, close=139, unknown=15 |
| `frame_coverage` | head_to_toe=**1368**, head_to_knee=923, head_to_hip=662, unknown=253, waist_up=112, chest_up=54, closeup=16, full_body=1 |
| `chest_region_visible` | true=**3045**, false=344 |
| `chest_region_obstruction` | clothing_fold=**1482**, none=1118, other=236, hair=222, arm=155, prop=116, hand=38, bag=14, water=5, shadow=3 |
| `breast_outline_readable` | false=**2220**, true=1169 |
| `outerwear` | dress=**1025**, jacket=850, knitwear=460, shirt=343, t_shirt=210, unclear=195, tank_top=88, other=66, none=52, camisole=43, swimsuit=19, tube_top=13, sportswear=13, bikini=11, lingerie=1 |
| `tight_fit` | false=**2452**, true=937 |
| `body_lean` | upright=**1878**, twisted=513, unknown=251, leaning_forward=238, crouching=235, leaning_back=231, lying=32, in_water=8, leaning=2, leaning_sideways=1 |
| `measurable` | false=**2220**, true=1169 —— **与 `breast_outline_readable` 完全一致**，是同一判断的两个名字 |

复核：
```bash
node -e "..." # 或复制 _probe-fields2.mjs，逐键统计
```

---

## 2. `plus-verdict.json` —— 阶段 3 聚合结果

**顶层键（实测，只有这四个）：**

```
summary, robustness_levels, per_session, per_frame
```

`summary` 的键：
```
channel, frames_judged, judges_used, raw_votes, primary_level,
primary_verdict_frame, primary_verdict_session, primary_p25_p75,
primary_p10_p90, sensitivity
```

### ⚠ 常见误猜（曾导致脚本崩溃）

| 误猜 | 实际 |
| --- | --- |
| `summary.levels` | **不存在**。分级数据在 `robustness_levels[]` |
| `per_frame[].breast_outline_readable` | **不存在**。它在 `classify.jsonl` |
| 顶层 `levels` | **不存在** |

`robustness_levels[]` 每项含：
```
frames_kept, votes_kept, unanimous_frames, mean_spread,
frame_histogram, vote_histogram, gated_out
```

`per_frame[]` 每项含：
```
file, median, votes, judges, session, reliability, reliability_spread
```

### 重要口径区分

| 字段 | 含义 | 实测值 |
| --- | --- | --- |
| `plus.per_frame` | **只含主门禁存活帧** | 1998 |
| `plus.summary.frames_judged` | **所有被判读帧** | 2858 |

两个数不同不是 bug，是设计。**报告里引用哪个数必须说清**。

---

## 3. `plus-plates.json` —— 图版清单

**顶层键（实测）：** `source`, `note`, `count`, `made`

```jsonc
{
  "count": 3243,
  "made": [
    { "i": 1, "file": "20220712_421_ccd📷_01.jpg",
      "outName": "plus_thumbs/p0001.jpg", "w": 1024, "h": 769 }
  ]
}
```

**`made` 是数组，不是对象**。元素键只有 `i, file, outName, w, h`。

图版实际路径 = `html_assets/` + `outName`。

> **事故**：曾猜键名为 `plates`/`frames`，结果 `plate entries : 0` → **1000 张全部渲染失败**（`failed 1000`）。好的一面是脚本报错清晰、未产出半成品页面。**教训：读文件真实结构，不要猜 JSON 形状。**

---

## 4. `_supp-results.jsonl` —— 附录判读落盘

378 行。判定分布实测：
```json
{"unclear":329,"A":31,"B":12,"C":3,"AA":3}
```

可读率 **13.0%**（49/378）。这个低值**不是判读失败**，原因见 `occluded_by`：

```json
{"clothing":129,"arm":120,"hair":73,"hand":22,"other":17,"none":9,"bag":8}
```
服装+手臂+头发合计 **85%**。判读模型自己的 note 反复提到 `puffer`、`fur gilet`、`fur coat`、`padded coat`、`shearling coat`、`teddy coat`、`parka`、`scarf`、`snow`、`bulky knit`、`collage`、`cropped at bust`。

**`unclear` 出口是有价值的**：若没有它，这 329 帧会被填成量表最小值，产生 **329 个捏造测量**。（对照：v1 提示词在 s0001–s0012 上返回全 `AA`，被弃用并全部重判为 `unclear`。）

---

## 5. 判读返回的 17 字段（补充轮次）

```
sid, shoulder_over_head, bust_over_head, underbust_over_head, waist_over_head,
hip_over_head, bust_projection, bust_larger_than_waist, underbust_creases_visible,
bust_still_projects_when_side, fit_verdict, garment, pose,
torso_turned_degree, occluded_by, reliability, note
```

### 枚举越界（判读模型会违反，落盘前必须清理）

| 字段 | 合法值 | 模型实际会返回 | 处理 |
| --- | --- | --- | --- |
| `bust_projection` | `flat\|slight\|moderate\|pronounced` | `unclear` | → `flat` |
| `bust_larger_than_waist` | `near_equal\|slightly_larger\|clearly_larger\|much_larger` | `unclear` | → `near_equal` |
| `garment` | （无 `cardigan`） | `cardigan` | → `knitwear` |
| `garment` | — | `other` | → `loose_top` |
| `pose` | — | `other` | → `standing_front` |

### 排序硬约束（必须校验）

真实读数下必须满足：

```
shoulder_over_head >= bust_over_head >= underbust_over_head
```

`_supp-sink.mjs` 中的检查**门控在 `readable` 上**，这样全零的 unreadable 行不会被拦：

```js
const readable = o.reliability >= 0.1 && o.fit_verdict !== 'unclear'
if (readable && o.bust_over_head > o.shoulder_over_head) push('bust>shoulder ' + …)
```

**历史违规**：s0109–s0120 有 7 帧 `shoulder` 1.8–1.9 但 `bust` 2.2–2.6 → 修正时显式修补 3 帧（s0109/s0114/s0115）。

---

## 6. `_supp-sink.mjs` 接口

```bash
node _supp-sink.mjs <file>              # 追加
node _supp-sink.mjs --replace <file>    # 就地对给定 sid 重写，不追加
node _supp-sink.mjs                     # 无参：打印 sink rows = N
```

输出：`accepted=N rejected=N replaced=N sink_total=N`，随后 `  REPLACED a,b,c` 与最多 10 条 `  REJECT <sid> :: <problems>`。

**顺序很重要：`validate` 在 `already-sunk` 之前跑。** 这是为了让合法修补路径不被幂等性挡住。

### 追加式落盘文件的铁律

> **已落盘的追加文件，永远不是重跑目标。**

**事故**：加了 `bust>shoulder` 检查后重跑 `_batch-0109-0120.json`，导致 9 帧写入两次（sink 120 → 129）。修法：`_dedupe-sink.mjs` 保留每 sid 最后一次写入（`rows_before=129 rows_after=120 dropped=9`）。

### `node --check` **不校验 JSON**

`_batch-0337-0348.json` 里一行损坏（`"note"` 前多了 `},`），`node --check` 放过，**只有 sink 返回 `rejected` 才抓到**。

> **sink 的 `rejected=N` 是第一道真实检查。**

---

## 7. 校准集硬约束（`_cal/`，6 帧）

补充轮次的判读与主轮次**不可直接互换**：

1. **系统性偏小**：三个可比帧全部更低，均值约低 **1.7 档**。
2. **用满序数范围**：担心的「坍缩到 A」**是假的**。
3. **`reliability` 量表不同**：补充轮 0.45–0.60 vs 主轮 0.62–0.72 → **门禁不可跨轮转移**。
4. **三票近似非独立**：判读模型把 `c001`/`c002` 称作 "Duplicate of c001"，并给出相同判定，而主轮次给了 C 和 B。

**推论：补充轮数据进独立附录，对任何头条数字零贡献。**

---

## 8. 抽样偏倚（附录不可当无偏估计）

附录的 378 帧**不是随机样本**：

| 月份 | 帧数 |
| --- | --- |
| 09 | 168 |
| 11 | 152 |
| （其余） | 58 |

而头部 2,865 帧分布均匀：`03:486 04:300 12:273 05:266 06:241 01:213 10:209`。

即 Sep+Nov 占附录 **85%**。

> **附录永远不得用作无偏估计，且对头条数字零贡献。**

---

## 9. 复核命令

```bash
# 字段值域
node scripts/_probe-fields2.mjs

# 候选宇宙计数
node scripts/_probe-universe.mjs

# 排序方案对比
node scripts/_probe-order.mjs

# 源图尺寸分布 + 依赖可用性
node scripts/_probe-resize.mjs
```
