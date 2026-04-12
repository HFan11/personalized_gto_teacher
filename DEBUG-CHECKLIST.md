# PokerGTO 深度体验Debug清单

每次改动后按此清单逐项验证。以职业玩家(Linus/Limitless)视角体验，不只是"能跑"，而是"结果对不对、体验好不好"。

---

## 一、翻前练习

### 1.1 场景生成
- [ ] 连续发10手，统计场景分布：vs_raise应该>50%，RFI<25%
- [ ] BB不应该出现RFI场景
- [ ] vs_3bet/vs_4bet手牌应该合理（不应该出现72o面对4bet）
- [ ] 描述文字包含位置(IP/OOP)
- [ ] vs_3bet/vs_4bet描述包含SPR和底池大小

### 1.2 策略准确性（边界case）
- [ ] AA任何位置RFI → ~100% raise
- [ ] 72o任何位置RFI → ~100% fold
- [ ] 99 vs 3bet → 应该大部分call（不是97% 4bet）
- [ ] AKo vs 3bet → 应该有4bet频率（不是84% call）
- [ ] QQ vs 4bet → 混合策略（~70% call, ~30% fold）
- [ ] JJ vs 4bet → 偏向fold（~55% fold）

### 1.3 评分
- [ ] 选最高频率action → 100分
- [ ] 选第二高频率action → 60-80分（不是0分）
- [ ] 选0%频率的action → 0分
- [ ] 分数不应该闪变（同一action只评一次）

### 1.4 推理文本
- [ ] 不出现"CFR求解器"、"Nash均衡"等技术术语
- [ ] 提到对手范围宽度（如"UTG开池范围约15%"）
- [ ] 提到阻断效应（AK阻断AA/KK/AK）
- [ ] 提到位置优劣势
- [ ] vs_3bet/vs_4bet提到SPR影响

---

## 二、翻后练习

### 2.1 发牌流程
- [ ] 点"发牌开始"后有loading动画
- [ ] 手牌先牌背→翻转为正面（不是直接出现正面）
- [ ] 公共牌依次翻转
- [ ] 底池显示6BB（SRP），SPR ~16
- [ ] hero和villain位置badge正确

### 2.2 底池计算（最关键！）
每一步验证 `pot + stack*2 ≈ 200BB`：
- [ ] 发牌后：pot=6, stack=97, total=200 ✓
- [ ] Hero bet 2/3 pot(4BB) + villain call → pot=14, stack=93, total=200 ✓
- [ ] Turn villain bet 2/3(9.3BB) + hero call → pot=32.6, stack=83.7, total=200 ✓
- [ ] River hero bet pot + villain call → pot应该合理，total=200 ✓
- [ ] **绝不应该出现pot>200BB**（之前有这个bug）

### 2.3 Action按钮
- [ ] Flop：显示Check/Bet（不facing bet时）或 Fold/Call/Raise（facing bet时）
- [ ] Turn：进入后显示正确的action按钮（不是"转牌→"）
- [ ] River：进入后显示正确的action按钮
- [ ] Bet后显示sizing选择（1/3, 1/2, 2/3, Pot, 1.5x, All-In）
- [ ] 确认按钮显示具体金额（如"确认 2/3 (4.0BB)"）

### 2.4 转牌/河牌过渡
- [ ] 点"转牌→"后只有新的一张牌翻转（前3张保持不动）
- [ ] 点"河牌→"后只有第5张牌翻转
- [ ] Hero手牌在turn/river不再重新翻转
- [ ] Street显示更新为Turn/River
- [ ] SPR正确更新

### 2.5 策略准确性（核心case）
- [ ] AK on A72r → bet（TPTK在干燥面打价值），不是100% check
- [ ] 87 on TT87 → check ~80%+（两对被board pair压制）
- [ ] AA on K55 facing bet → call（超对，不需要raise）
- [ ] Air on AK2 → check ~90%+（空气放弃）
- [ ] Set on monotone → bet large（保护+价值）
- [ ] TT on 2J942 river IP → check摊牌（不是"设陷阱"）

### 2.6 推理文本质量
- [ ] 不说"CFR求解器判定"
- [ ] 不说IP河牌check是"设陷阱"
- [ ] Paired board上不对强牌说"被trips压制"
- [ ] 提到对手范围组成（value X% / draw Y% / air Z%）
- [ ] Facing bet时提到底池赔率
- [ ] 提到beatsHeroPct（"对手X%的combo强于你"）
- [ ] 有blocker提到阻断效应
- [ ] 对手类型影响推理（NIT/FISH/LAG）

### 2.7 评分一致性
- [ ] 同一action不应该评分闪变（先100后21）
- [ ] Check评分后结果立即显示（不等45秒）
- [ ] "分析中..."spinner在结果出来前显示
- [ ] 推荐的action频率>0%
- [ ] 不应该出现两个相同名称的action（如两个"1/3底池"）

### 2.8 Undo/新手牌
- [ ] "← 撤回"能恢复到上一步
- [ ] 撤回后重新action，结果应该一致（seeded RNG）
- [ ] "新手牌"直接发新牌（不回设置页）
- [ ] "下一手→"在hand结束后出现

---

## 三、C++ Solver集成

### 3.1 Console日志检查（F12）
- [ ] 启动时："Precomputed index loaded: 103 flops"
- [ ] Flop action时："Precomputed: matched Xs,Xd,Xc (category)"
- [ ] Turn进入时："C++ solver ready for turn: Xms"
- [ ] 不应该出现："C++ solver: unavailable"（如果Railway在线）
- [ ] 不应该出现未捕获的JS错误

### 3.2 预计算Flop
- [ ] 103个flop文件都在 `/data/precomputed/flop/`
- [ ] index.json可访问
- [ ] Board匹配到最近的预计算结果（不是随机的）

### 3.3 C++ Turn/River
- [ ] Turn action用C++ solver结果（console显示"Using C++ solver"）
- [ ] River action用C++ solver结果（如果有）
- [ ] C++ solver超时时fallback到JS solver（不是挂住）

---

## 四、UI/UX细节

### 4.1 动画
- [ ] 翻前手牌有翻转动画
- [ ] 翻后公共牌有翻转动画
- [ ] Turn/River只翻新牌

### 4.2 响应时间
- [ ] Flop action：<1秒（预计算查表）
- [ ] Turn action：<10秒（C++ solver）
- [ ] River action：<5秒
- [ ] 翻前发牌：<2秒
- [ ] 不应该出现"无响应"浏览器提示

### 4.3 显示
- [ ] 手牌分类badge颜色正确（nuts红、air灰等）
- [ ] 权益条颜色和长度正确
- [ ] 对手范围分析面板可展开/收起
- [ ] Timeline(行动历史)正确更新
