# portrait-master · 人物大师

人像相册批量结构化分析与图文报告的工具包。对整本相册做视觉分类、逐帧结构化判读、多票一致性聚合，按证据强度挑图，最终生成**自包含单文件 HTML 报告**（图片以 base64 内嵌，双击即可查看，不依赖任何文件夹）。

## 本仓库包含什么

| 路径 | 内容 |
|---|---|
| `SKILL.md` | 完整说明：适用范围、13 节流水线文档、四条硬约束、诚实披露门禁 |
| `references/field-reference.md` | 所有数据文件的字段值域、`plus-verdict.json` 常见误猜表、校准硬约束 |
| `references/pitfalls.md` | 37 条真实事故记录（A–F 六类），含一次判读拒绝与后续处理的完整记录 |
| `scripts/` | 34 个流水线脚本，全部可 `node --check` 通过 |

## 本仓库**不**包含什么

- **不含任何图片**。所有缩略图与 HTML 报告均由脚本从本地相册现场生成。
- **不含任何分类数据**。`classify.jsonl`、`plus-verdict.json` 等中间产物不在此仓库。
- **不含任何凭据**。脚本从环境变量读取路径，不内嵌 key。

## 用之前要改什么

脚本里的根路径是占位符，通过环境变量覆盖即可：

```powershell
$env:PORTRAIT_ROOT      = 'D:\your-album\_probe'   # 工作目录
$env:PORTRAIT_PHOTO_ROOT = 'D:\your-album'          # 相册根目录
$env:DSH_HOME            = 'C:\Users\you\.dsh'      # 凭据与模块所在处
```

> 34 个脚本中 33 个把根路径硬编码为默认值（因此换相册需改配置或设环境变量）；唯一用 `import.meta.url` 自动定位的是 `scripts/link-plus-plates.mjs`。

## 适用范围（重要）

本工具包**只做呈现层**：读取分类器与判读模型输出的字段，做聚合、排序与渲染。它**不测量**照片中人物的任何身体属性，也无法从单张照片恢复绝对尺度。所有生成的页面都带有「未目视查看过这些照片」的披露声明。

`references/pitfalls.md` 中完整记录了一次判读模型对某批帧的**真实拒绝**，以及随后换措辞重试的过程 —— 保留为反面教材：**遇到拒绝应把该批帧归入「未知」层，而不是改写提示词直到另一个判读者同意。**

## 快速开始

```powershell
cd scripts
node _pick-keyframes.mjs      # 挑帧
node batch-classify.mjs       # 视觉分类
node build-full-plates.mjs    # 生成缩略图
node _make-single-file.mjs    # 输出单文件 HTML 报告
```

完整流程、校验清单与断点续跑方式见 `SKILL.md`。
