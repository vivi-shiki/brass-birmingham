# Brass: Birmingham 规则规格与数据结构草案

用途：为开发数字桌游版 Brass: Birmingham 建立规则模型、概念词典、状态结构和动作命令结构。本文是面向实现的规则摘要，不是官方规则书全文。

主要依据：

- 本地 PDF：`C:/Users/about/Downloads/Brass-Birmingham-Rulebook-2018.11.20-highlights.pdf`
- 官方 PDF 地址：[Roxley rulebook](https://files.roxley.com/Brass-Birmingham-Rulebook-2018.11.20-highlights.pdf)
- 文本化规则核对：[RulesPal rulebook](https://www.rulespal.com/brass-birmingham/rulebook)
- 规则摘要核对：[Order of Gamers reference](https://www.orderofgamers.com/downloads/BrassBirmingham_v1.2.pdf)
- 教学视频索引核对：[Meeple University quick tutorial](https://www.meepleuniversity.com/2025/08/18/brass-birmingham-start-playing-in-13-minutes-quick-start-board-game-tutorial/)
- 常见误区核对：[BGG 官方 FAQ 入口](https://boardgamegeek.com/thread/2545744/official-brass-birmingham-faq)、[Reddit 漏规则讨论](https://www.reddit.com/r/boardgames/comments/1lillml/brass_birmingham_the_rules_we_missed/)

## 1. 设计原则

实现时建议把游戏拆成三层：

1. `StaticConfig`：不会随一局游戏变化的配置。包括地图、城市槽位、连接线、商人空间、卡牌、产业牌堆、市场价格、收入轨。
2. `GameState`：一局游戏的动态状态。包括当前时代、轮次、行动槽、玩家现金/收入位置/VP、手牌、弃牌、版图占用、市场剩余资源。
3. `RulesEngine`：纯规则函数。输入 `GameState + ActionCommand`，输出 `ValidationResult` 或 `StatePatch/Event[]`。

重要实现建议：

- 不要只存“收入等级”，要存 `incomeTrackPosition`。翻面产业和牛津奖励是“前进若干格”，贷款是“后退若干收入等级并放在目标等级最高格”。
- 区分“玩家网络”和“连通路径”。玩家网络只看该玩家自己的产业和连接；连通路径用所有玩家的连接。
- 所有资源消耗都应生成事件，资源耗尽时触发产业翻面与收入提升。
- 动作先完整验证，再一次性提交状态变更。尤其是 Build、Sell、Network 会有多步资源选择和连锁翻面。

## 2. 核心枚举

```ts
type PlayerCount = 2 | 3 | 4;

type Era = "canal" | "rail";

type IndustryType =
  | "cotton_mill"
  | "coal_mine"
  | "iron_works"
  | "manufacturer"
  | "pottery"
  | "brewery";

type ResourceType = "coal" | "iron" | "beer";

type ActionType =
  | "build"
  | "network"
  | "develop"
  | "sell"
  | "loan"
  | "scout"
  | "pass";

type CardType =
  | "location"
  | "industry"
  | "wild_location"
  | "wild_industry";

type LocationKind = "city" | "merchant" | "farm_brewery";

type LinkType = "canal" | "rail";
```

## 3. 概念精确定义

### 玩家属性

`Player` 是游戏主体，至少有这些属性：

- `cash`：现金，单位为英镑。
- `victoryPoints`：胜利点，可超过 100，不能因短缺扣到 0 以下。
- `incomeTrackPosition`：收入标记在进度轨的位置。开始在规则书所称的 “10” 格，该位置对应收入等级 0。
- `incomeLevel`：从 `incomeTrackPosition` 映射得到的回合收入。正数收钱，负数付款。
- `spentThisRound`：本轮为了执行行动花掉的钱，用于下轮顺位排序。
- `hand`：手牌。
- `discardPile`：个人弃牌堆；设置时底部 1 张面朝下，普通行动弃牌面朝上。
- `faceDownDiscardCount`：弃牌堆底部仍为面朝下的卡牌数量。标准局开局为 1，进入 Rail Era 洗入新牌堆后归 0。
- `industryTileStacks`：6 类产业牌堆，每类按可建造顺序从低级到高级排列。
- `remainingLinks`：剩余 canal/rail 连接牌数量。

注意：

- 收入提升是前进“格”，不是收入等级。
- 贷款是后退“收入等级”，不是格。
- 终局平分时建议比较 `incomeTrackPosition`，若只按规则书字面也可比较 `incomeLevel`；公开讨论中常按“收入标记位置更高”处理同等级收入。

### 资源

`coal`、`iron`、`beer` 都是资源类型，但消耗规则不同。

- 煤必须通过连接运输。产业或铁路线在放置后必须与煤源连通。
- 铁不需要连通。可从任意未翻面的铁厂取。
- 啤酒用于出售和铁路时代一次 Network 放 2 条铁路。自己的啤酒不需连通；对手啤酒需要连通；商人啤酒只可在 Sell 中使用。

资源实体建议建模为：

```ts
type ResourceSource =
  | { kind: "industry_tile"; industryInstanceId: string; resourceType: ResourceType }
  | { kind: "market"; market: "coal" | "iron"; price: number }
  | { kind: "merchant_beer"; merchantSpaceId: string; merchantTileInstanceId: string };
```

### 地点、城市和连接

`Location` 是所有地图节点的总称。城市、商人地点和农场酒厂都可作为连接线端点。

- `City`：有名称、区域颜色、多个建筑位置。
- `MerchantLocation`：外部商人地点，可能有 1-2 个商人空间，带奖励类型。
- `FarmBreweryLocation`：匿名农场酒厂，只能放酒厂产业。
- `LinkLine`：一条可建造连接线，必须连接两个地点；可支持 canal、rail 或两者。

用户口语中的“道路”建议在程序中命名为 `linkLine`，因为实体可能是运河或铁路。

```ts
interface LocationBase {
  id: string;
  name: string;
  kind: LocationKind;
  printedLinkIcons?: number;
}

interface City extends LocationBase {
  kind: "city";
  region: string;
  slots: CitySlot[];
}

interface CitySlot {
  id: string;
  cityId: string;
  allowedIndustryTypes: IndustryType[];
  occupiedBy?: string; // IndustryInstance.id
}

interface LinkLine {
  id: string;
  endpointA: string; // Location.id
  endpointB: string; // Location.id
  allowedLinkTypes: LinkType[];
  occupiedBy?: string; // LinkInstance.id
  special?: {
    viaFarmBreweryId?: string;
    notes?: string;
  };
}
```

特殊连接：

- Cannock 左侧农场酒厂需要单独连接线才与 Cannock 连通。
- Kidderminster-Worcester 的连接线同时连接其左侧农场酒厂；不能再额外放第二条连接线。

### 建筑位置

建筑位置是城市上的一个 `CitySlot`。

- 一个槽位可允许一个或多个产业类型。
- Build 时，如果同一城市存在“只显示该产业图标”的可用槽位，必须优先放在那里；只有没有纯槽位时才可放在混合槽位。
- Canal Era 每个玩家在同一地点最多 1 个产业牌，但不同玩家可共处同一地点。
- Rail Era 每个玩家可在同一地点建多个产业牌。

### 产业牌

产业牌分为静态模板和动态实例。

静态模板：

```ts
interface IndustryTileSpec {
  id: string;
  industryType: IndustryType;
  level: number;
  sequenceIndex: number;
  count: number;
  buildableEras: Era[];
  cost: {
    cash: number;
    coal: number;
    iron: number;
  };
  flip: {
    trigger: "sell" | "resource_depleted";
    incomeSpaces: number;
    victoryPoints: number;
    linkIcons: number;
  };
  resourcesWhenBuilt?: Partial<Record<Era, number>>; // coal/iron/beer数量
  beerRequiredToSell?: number; // 仅 cotton/manufacturer/pottery
  canDevelop: boolean;
  special?: {
    lightbulbPottery?: boolean; // 不可 Develop，只能 Build 掉
  };
}
```

动态实例：

```ts
interface IndustryInstance {
  id: string;
  specId: string;
  ownerPlayerId: string;
  industryType: IndustryType;
  level: number;
  locationId: string;
  slotId: string;
  flipped: boolean;
  remainingResource: number;
  removedFromGame: boolean;
}
```

分类：

- 资源产业：Coal Mine、Iron Works、Brewery。资源被取完时翻面。
- 可出售产业：Cotton Mill、Manufacturer、Pottery。通过 Sell 翻面。

翻面效果：

- 立即提升收入标记若干格。
- VP 不在翻面时获得，而是在时代结算时计分。

### 卡牌

卡牌分为位置牌、产业牌、万能位置牌、万能产业牌。

```ts
interface CardSpec {
  id: string;
  type: CardType;
  locationId?: string;
  industryType?: IndustryType;
  minPlayers?: PlayerCount; // 少于该人数时移除
  regionColor?: string;
}
```

Build 是唯一要求“特定牌”的行动：

- 位置牌：在牌面地点建任意允许产业，不要求该地点在玩家网络内。
- 万能位置牌：当任意位置牌使用，但不能代表两个农场酒厂。
- 产业牌：在玩家网络内任意地点建该产业。
- 万能产业牌：当任意产业牌使用，仍要求地点在玩家网络内。
- 如果玩家版图上没有任何产业或连接，可用产业牌在任意地点建对应产业；可用任意牌 Network 放第一条连接。

非 Build 行动通常可弃任意一张牌。万能牌被弃时回到对应公共牌区，不进弃牌堆。

### 商人

建议拆分为商人地点、商人空间、商人牌。

```ts
interface MerchantLocation extends LocationBase {
  kind: "merchant";
  bonus: MerchantBonus;
  spaces: MerchantSpace[];
  providesCoalMarketConnection: boolean;
}

interface MerchantSpace {
  id: string;
  locationId: string;
  minPlayers: PlayerCount;
  merchantTileInstanceId?: string;
  beerPresent: boolean;
}

interface MerchantTileSpec {
  id: string;
  minPlayers: PlayerCount;
  acceptedIndustryTypes: IndustryType[]; // 非空表示牌面图标
  blank: boolean;
}

type MerchantBonus =
  | { type: "develop"; count: 1 }
  | { type: "income_spaces"; spaces: 2 }
  | { type: "victory_points"; points: number }
  | { type: "cash"; cash: 5 };
```

规则：

- 设置时移除人数不适用的商人牌，再洗混，放到相应人数启用的商人空间。
- 非空商人牌旁放 1 个商人啤酒。
- Sell 时必须连接到带对应产业图标的商人牌。
- 单次“出售一个产业”的步骤只选择一个目标商人牌；若该商人牌旁有啤酒，可把这 1 个商人啤酒作为所需啤酒之一并获得该商人地点奖励。
- 一个 Sell 行动可以重复出售多个产业，因此可以在同一行动内通过多个出售步骤消耗多个商人啤酒并获得多个奖励。
- 若一个产业需要 2 个啤酒，最多 1 个可来自其目标商人牌；其他啤酒必须来自酒厂。

### 市场

煤市场和铁市场是外部资源市场。

```ts
interface ResourceMarket {
  resourceType: "coal" | "iron";
  priceSlotsCheapestToMostExpensive: number[];
  occupiedCount: number;
  fallbackPriceWhenEmpty: number;
  requiresConnection: boolean;
}
```

建议静态配置：

```ts
const coalMarket = {
  resourceType: "coal",
  priceSlotsCheapestToMostExpensive: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 8],
  initialOccupiedCount: 13,
  fallbackPriceWhenEmpty: 8,
  requiresConnection: true,
};

const ironMarket = {
  resourceType: "iron",
  priceSlotsCheapestToMostExpensive: [1, 1, 2, 2, 3, 3, 4, 5, 6, 6],
  initialOccupiedCount: 8,
  fallbackPriceWhenEmpty: 6,
  requiresConnection: false,
};
```

设置：

- 煤市场每格放煤，留一个 £1 空位。
- 铁市场每格放铁，留两个 £1 空位。
- 普通供应视为无限。

## 4. 游戏流程

### 设置

```ts
interface GameSetupConfig {
  playerCount: PlayerCount;
  includedCards: CardSpec[];
  includedMerchantTiles: MerchantTileSpec[];
  initialCashPerPlayer: 17;
  initialHandSize: 8;
  initialFaceDownDiscardPerPlayer: 1;
}
```

流程：

1. 根据人数移除超过人数标记的卡牌和商人牌。
2. 万能位置牌与万能产业牌各放到公共牌区。
3. 其他卡牌洗混为抽牌堆。
4. 洗混商人牌，放到本人数启用的商人空间；非空商人牌旁放 1 个啤酒。
5. 填充煤/铁市场。
6. 每名玩家获得 £17、玩家板、产业牌堆、14 条连接牌、收入标记、VP 标记。
7. 每名玩家抽 8 张牌作为手牌，再抽 1 张额外牌面朝下放入自己的弃牌堆。
8. 玩家角色牌随机排序，形成第一轮行动顺序。

人数影响：

- 2 人：移除蓝色和青绿色位置牌；相应高人数商人空间不用。
- 3 人：移除青绿色位置牌；Nottingham 不放商人。
- 4 人：全部位置牌可用。
- 即使某些位置牌因人数被移除，仍可用产业牌/万能产业牌在那些地点建造，只要满足网络和槽位规则。

### 时代、轮、回合、行动

游戏有两个时代：

- Canal Era：1770-1830。
- Rail Era：1830-1870。

一轮中，每名玩家按行动顺序执行一个玩家回合。

玩家回合：

- Canal Era 第一轮：每名玩家只执行 1 个行动。
- 其他所有玩家回合：执行 2 个行动。
- 每个行动必须弃 1 张牌；Pass 也要弃牌。
- 同一玩家回合内可以重复选择同一行动。
- 完成该玩家回合后，从抽牌堆补牌至 8 张；抽牌堆空后，手牌会逐轮减少。

时代结束：

- 当一轮结束且所有玩家用完手牌、抽牌堆也为空时，该时代结束。
- 2/3/4 人每时代分别正好 10/9/8 轮。

### 轮末

一轮所有玩家完成回合后：

1. 按本轮花钱从少到多排序行动顺序。花钱最少下轮先手；平手保持原相对顺序。
2. 将角色牌上的钱归还银行，清空 `spentThisRound`。
3. 收入阶段：每名玩家按 `incomeLevel` 收钱或付钱。终局最后一轮不收收入。

负收入短缺：

- 若玩家付不起负收入，必须移除自己版图上的一个或多个产业牌来筹钱；每个按建造现金成本的一半向下取整。
- 只能为支付负收入短缺而移除产业牌，不能移除连接牌。
- 一旦筹够必须停止；多余现金保留。
- 若仍无法支付，每缺 £1 尽可能失去 1 VP。

### 时代结算

每个时代结束后：

1. 连接计分：每名玩家的每条连接，按两端地点显示的连接图标数量得 VP。连接图标可来自已翻面产业牌或版图印刷图标。计分后移除这些连接。
2. 产业计分：每名玩家版图上已翻面的产业牌按其 VP 值得分；未翻面产业不计。

Canal Era 额外维护：

1. 移除版图上所有 Level 1 产业牌；Level 2 或更高产业留在版图上。
2. 为每个非空商人牌旁的空啤酒位补 1 个啤酒。
3. 将所有玩家弃牌堆洗混为 Rail Era 抽牌堆。
4. 每名玩家抽 8 张牌。

Rail Era 结算后游戏结束。

胜负：

1. VP 最高者胜。
2. 平手比收入位置/收入高低。
3. 仍平手比现金。
4. 仍平手并列。

## 5. 资源消耗规则

### 消耗煤

煤用于建造某些产业和铁路连接。

输入应包含 `coalDemandAnchor`：

- 建产业：新产业所在地点。
- 建铁路：新铁路连接线；计算时先临时视为该铁路已放置。

消耗顺序：

1. 在与需求点连通的未翻面煤矿中，找距离最近的煤矿。距离按已建连接线数量计算，所有玩家连接线都算。若多个最近，玩家可选。
2. 从该煤矿取煤，免费。若取完，煤矿翻面，其拥有者收入提升。
3. 若没有连通煤矿，可从煤市场购买，但需求点必须连到外部煤市场图标/商人地点。按最便宜可用格购买；市场空后仍可按 £8/煤购买。

多煤需求逐个处理。第一个煤取完导致翻面后，第二个煤重新选择合法来源。

### 消耗铁

铁用于 Develop 和建造某些产业。

规则：

1. 可从任意未翻面铁厂取铁，不需要连通，也不要求最近。
2. 若没有可用铁厂，再从铁市场购买。按最便宜可用格购买；市场空后仍可按 £6/铁购买。
3. 取完铁厂时，该铁厂翻面，拥有者收入提升。

### 消耗啤酒

啤酒用于 Sell 和 Rail Era 一次 Network 放 2 条铁路。

来源：

1. 自己的未翻面酒厂：不需要连通。
2. 对手的未翻面酒厂：必须与需求地点连通。
3. 商人啤酒：只可在 Sell 时，从当前出售目标商人牌旁消耗。

多啤酒需求可来自不同来源。

Network 双铁路的特殊点：

- 所需啤酒必须来自酒厂，不能来自商人。
- 若用对手酒厂，必须与第二条铁路放置后的连接线连通。

## 6. 动作规则

### Build

命令结构：

```ts
interface BuildCommand {
  type: "build";
  playerId: string;
  cardId: string;
  locationId: string;
  slotId: string;
  industryType: IndustryType;
  coalSources?: ResourceSource[];
  ironSources?: ResourceSource[];
}
```

验证：

1. 玩家手中有 `cardId`，且卡牌满足 Build 要求。
2. 选择的地点和槽位允许该产业。
3. 选择的是该玩家该产业牌堆当前最低级可用牌。
4. 当前时代允许建造该牌。
5. 槽位为空，或满足 Overbuild。
6. Canal Era 同地点该玩家最多 1 个产业。
7. 若存在该产业纯槽位，不能选择混合槽位。
8. 玩家有足够现金支付产业成本和市场资源成本。
9. 所需煤/铁来源合法。
10. 农场酒厂只能用 Brewery 产业牌或 Wild Industry 建造。

应用：

1. 弃牌。
2. 支付现金和市场资源费用，并计入 `spentThisRound`。
3. 消耗煤/铁。
4. 若 Overbuild，移除原产业，原有资源回供应。
5. 放置新产业。
6. 若是煤矿/铁厂，放置资源后立即尽可能卖入市场：
   - 煤矿只有在连到任意商人/外部市场地点时才卖煤到市场。
   - 铁厂总是可卖铁到市场。
   - 填市场时填最贵空格；每卖 1 个资源，玩家收对应现金。
   - 若因此资源清空，产业立即翻面。
7. 若是酒厂，Canal Era 放 1 啤酒，Rail Era 放 2 啤酒。

### Overbuild

Overbuild 是 Build 的特殊情况：用更高级的同产业牌替换已在版图上的产业。

规则：

- 替换自己的产业：任意产业都可替换，只要新牌同产业且等级更高。
- 替换对手产业：只允许替换 Coal Mine 或 Iron Works；且整个版图和对应市场中该资源数量必须为 0。
- 被替换产业移出游戏，不再计分。
- 被替换者已经获得的收入或 VP 不回退。

### Network

命令结构：

```ts
interface NetworkCommand {
  type: "network";
  playerId: string;
  cardId: string;
  linkLineIds: string[]; // canal最多1条，rail可1或2条
  coalSources?: ResourceSource[];
  beerSourceForDoubleRail?: ResourceSource;
}
```

验证：

1. 弃任意 1 张牌。
2. 连接线未占用。
3. 连接线支持当前时代的连接类型。
4. 连接线至少一端属于玩家网络。若玩家版图上没有任何产业或连接，则第一条可放任意合法空连接线。
5. Canal Era：只能放 1 条 canal，成本 £3。
6. Rail Era：可放 1 条 rail，成本 £5 + 1 煤；或放最多 2 条 rail，成本 £15 + 每条 1 煤 + 1 啤酒。
7. 每条 rail 分别放置并分别消耗煤；第二条 rail 可利用第一条 rail 新建立的连通。

应用：

- 放置连接牌，减少玩家对应连接牌数量。
- 支付现金并记录本轮花费。
- 消耗煤/啤酒，可能触发产业翻面。

### Develop

命令结构：

```ts
interface DevelopCommand {
  type: "develop";
  playerId: string;
  cardId: string;
  industryTypes: IndustryType[]; // 1或2个，可相同，按顺序处理
  ironSources?: ResourceSource[];
}
```

验证：

1. 弃任意 1 张牌。
2. 移除 1 或 2 个产业牌。
3. 每次移除都必须是所选产业牌堆当前最低级可用牌。
4. 每移除 1 个消耗 1 铁。
5. 带 lightbulb 禁止符号的 Pottery 不能 Develop，只能 Build。

应用：

- 消耗铁。
- 将被 Develop 的产业牌从玩家板移出游戏。
- 弃牌。

### Sell

命令结构：

```ts
interface SellCommand {
  type: "sell";
  playerId: string;
  cardId: string;
  sales: SellStep[];
}

interface SellStep {
  industryInstanceId: string;
  merchantSpaceId: string;
  beerSources?: ResourceSource[];
}
```

验证：

1. 弃任意 1 张牌。
2. 每个出售步骤的产业必须属于玩家、未翻面、且类型为 Cotton Mill / Manufacturer / Pottery。
3. 该产业所在地必须与目标商人牌所在地点连通。
4. 目标商人牌必须显示该产业图标。
5. 必须能消耗该产业牌所需啤酒数量。
6. 若使用商人啤酒，只能使用目标商人牌旁的 1 个啤酒。
7. 同一个 Sell 行动可按顺序出售多个产业，甚至不同产业。

应用每个出售步骤：

1. 消耗啤酒。
2. 如果消耗商人啤酒，立即获得该商人地点奖励。
3. 翻面产业。
4. 产业拥有者收入标记前进对应格数。

### Loan

命令结构：

```ts
interface LoanCommand {
  type: "loan";
  playerId: string;
  cardId: string;
}
```

规则：

- 弃任意 1 张牌。
- 从银行拿 £30。
- 收入标记后退 3 个收入等级，并放在新收入等级的最高格。
- 若会让收入等级低于 -10，则不能贷款。
- 贷款不偿还。官方 2018 规则书没有“最后两轮不能贷款”的限制；若视频或平台实现有该限制，应作为变体处理。

### Scout

命令结构：

```ts
interface ScoutCommand {
  type: "scout";
  playerId: string;
  cardIds: [string, string, string];
}
```

规则：

- 弃 3 张牌：1 张为行动牌，2 张额外牌。
- 获得 1 张 Wild Location 和 1 张 Wild Industry。
- 若玩家手中已经有任意 Wild card，不能 Scout。
- 若公共万能牌不足，也不能 Scout。

### Pass

命令结构：

```ts
interface PassCommand {
  type: "pass";
  playerId: string;
  cardId: string;
}
```

规则：弃任意 1 张牌，不做其他事。

### Resolve Negative Income

命令结构：

```ts
interface ResolveNegativeIncomeCommand {
  type: "resolve_negative_income";
  playerId: string;
  industryInstanceIds: string[];
}
```

规则：

- 只能在 `pendingDecision.type === "negative_income"` 时执行。
- `playerId` 必须是欠款玩家。
- 每个 `industryInstanceIds` 必须指向该玩家版图上的产业；已翻面或未翻面产业都可被移除。
- 已翻面产业被移除时，不回退已经获得的收入或已经结算过的 VP，但之后不能再参与时代结算。
- 按所选顺序出售产业，每个产业获得其现金成本向下取整的一半，产业从版图移除且不再计分。
- 若已无合法可出售产业，或通过出售与现金已经足以覆盖欠款，则结算剩余欠款；仍不足的部分转为 VP 损失。
- 结算完成后清除挂起决策，并继续原本被打断的收入/时代推进流程。

### Resolve Merchant Develop

命令结构：

```ts
interface ResolveMerchantDevelopCommand {
  type: "resolve_merchant_develop";
  playerId: string;
  industryTypes: IndustryType[];
}
```

规则：

- 只能在 `pendingDecision.type === "merchant_develop"` 时执行。
- `playerId` 必须是获得商人奖励的玩家。
- `industryTypes` 按顺序处理，每一项都必须能 Develop：只能移除对应产业牌堆当前最低级可用牌，且不能移除带禁止 Develop 标记的 Pottery。
- 最多移除商人奖励允许的数量；只有在没有更多合法可 Develop 牌时，才允许少移除。
- 结算完成后清除挂起决策，并继续回合/时代推进。

## 7. 网络与连通函数

### 玩家网络

一个地点属于某玩家网络，当且仅当：

1. 该地点含有该玩家至少一个产业牌；或
2. 该地点与该玩家至少一条连接牌相邻。

```ts
function isInPlayerNetwork(state: GameState, playerId: string, locationId: string): boolean;
```

用途：

- 使用产业牌或 Wild Industry 建造时判定地点是否可建。
- Network 放连接时判定新连接是否从玩家网络延伸。

### 连通地点

两个地点连通，当且仅当能沿着已建连接牌形成路径。连接牌归属不限。

```ts
function areConnected(state: GameState, a: string, b: string): boolean;
function connectedComponent(state: GameState, start: string): Set<string>;
```

用途：

- 煤运输。
- 对手酒厂啤酒。
- Sell 连接商人。
- 从煤市场买煤时连接外部市场。

## 8. 动态状态结构

```ts
interface GameState {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  playerCount: PlayerCount;
  era: Era;
  roundNumber: number;
  turnOrder: string[];
  currentTurnIndex: number;
  actionIndexInTurn: number;
  actionsAllowedThisTurn: 1 | 2;

  players: Record<string, PlayerState>;
  board: BoardState;
  cardZones: CardZones;
  markets: {
    coal: MarketState;
    iron: MarketState;
  };
  eventLog: GameEvent[];
  nextInstanceId: number;
  status: "playing" | "ended";
  variant?: GameVariant;
  pendingDecision?: PendingDecision;
  lastEraScore?: EraScoreBreakdown;
}

interface PlayerState {
  id: string;
  name: string;
  cash: number;
  victoryPoints: number;
  incomeTrackPosition: number;
  spentThisRound: number;
  handCardIds: string[];
  discardCardIds: string[];
  faceDownDiscardCount: number;
  industryTileStacks: Record<IndustryType, PlayerIndustryStack>;
  remainingLinks: Record<LinkType, number>;
}

interface PlayerIndustryStack {
  availableSpecIdsInOrder: string[];
  removedSpecIds: string[];
  builtInstanceIds: string[];
}

interface BoardState {
  industryInstances: Record<string, IndustryInstance>;
  linkInstances: Record<string, LinkInstance>;
  slots: Record<string, { occupiedBy?: string }>;
  linkLines: Record<string, { occupiedBy?: string }>;
  merchantSpaces: Record<string, MerchantSpaceState>;
}

interface LinkInstance {
  id: string;
  ownerPlayerId: string;
  linkType: LinkType;
  linkLineId: string;
}

interface MerchantSpaceState {
  id: string;
  merchantTileInstanceId?: string;
  beerPresent: boolean;
}

interface CardZones {
  drawDeck: string[];
  wildLocationPool: string[];
  wildIndustryPool: string[];
}

interface MarketState {
  occupiedCount: number;
}

interface EraScoreBreakdown {
  era: Era;
  linkVictoryPointsByPlayer: Record<string, number>;
  industryVictoryPointsByPlayer: Record<string, number>;
  totalVictoryPointsByPlayer: Record<string, number>;
}

type PendingDecision = NegativeIncomeDecision | MerchantDevelopDecision;

interface NegativeIncomeDecision {
  type: "negative_income";
  playerId: string;
  amountOwed: number;
  incomePlayerIndex: number;
}

interface MerchantDevelopDecision {
  type: "merchant_develop";
  playerId: string;
  count: number;
  merchantSpaceId: string;
  merchantSpaceIds?: string[];
}
```

## 9. 静态配置结构

```ts
interface StaticConfig {
  components: PhysicalComponentManifest;
  audit: StaticDataAuditManifest;
  incomeTrack: IncomeTrackConfig;
  locations: Record<string, City | MerchantLocation | FarmBreweryLocation>;
  linkLines: Record<string, LinkLine>;
  cardSpecs: Record<string, CardSpec>;
  merchantTileSpecs: Record<string, MerchantTileSpec>;
  industryTileSpecs: Record<string, IndustryTileSpec>;
  industryStackSpecIds: Record<IndustryType, string[]>;
  markets: {
    coal: ResourceMarket;
    iron: ResourceMarket;
  };
  rules: {
    initialCash: 17;
    handSize: 8;
    firstCanalRoundActions: 1;
    normalActionsPerTurn: 2;
    loanCash: 30;
    loanIncomeLevelPenalty: 3;
    canalLinkCost: 3;
    railSingleLinkCost: 5;
    railDoubleLinkCost: 15;
    railCoalPerLink: 1;
    railDoubleBeer: 1;
  };
}

interface IncomeTrackConfig {
  positions: IncomeTrackPosition[];
  startPosition: number;
  minIncomeLevel: -10;
  maxIncomeLevel: 30;
}

interface IncomeTrackPosition {
  position: number;
  incomeLevel: number;
}

type StaticDataAuditStatus =
  | "manifest_locked"
  | "manifest_locked_face_audit_pending";

interface StaticDataAuditArea {
  status: StaticDataAuditStatus;
  rulebookPages: number[];
  sourceRefs: string[];
  coveredByTests: string[];
  note: string;
}

interface StaticDataAuditManifest {
  components: StaticDataAuditArea;
  setupAndTurnRules: StaticDataAuditArea;
  locationsAndSlots: StaticDataAuditArea;
  linkLines: StaticDataAuditArea;
  regularCards: StaticDataAuditArea;
  wildCards: StaticDataAuditArea;
  industryTiles: StaticDataAuditArea;
  merchantTiles: StaticDataAuditArea;
  markets: StaticDataAuditArea;
  incomeTrack: StaticDataAuditArea;
}
```

收入轨建议完整录入每一格，而不是用公式硬推。这样能准确处理“前进格数”和“贷款回退等级到最高格”。

## 10. 事件模型

事件模型能支持回放、撤销、日志和联机同步。

```ts
type GameEvent =
  | { type: "game_created"; gameId: string; playerIds: string[] }
  | { type: "card_discarded"; playerId: string; cardId: string; destination: "discard" | "wild_pool" }
  | { type: "cash_changed"; playerId: string; delta: number; reason: string }
  | { type: "income_position_changed"; playerId: string; from: number; to: number; reason: string }
  | { type: "industry_built"; instance: IndustryInstance }
  | { type: "industry_removed"; industryInstanceId: string; reason: "overbuild" | "develop" | "canal_cleanup" | "negative_income" }
  | { type: "industry_flipped"; industryInstanceId: string; ownerPlayerId: string }
  | { type: "industry_sold"; industryInstanceId: string; ownerPlayerId: string; merchantSpaceId: string }
  | { type: "resource_consumed"; source: ResourceSource; byPlayerId: string; reason: string }
  | { type: "resource_sold_to_market"; industryInstanceId: string; market: "coal" | "iron"; cashReceived: number }
  | { type: "link_built"; instance: LinkInstance }
  | { type: "link_scored"; linkInstanceId: string; ownerPlayerId: string; points: number }
  | { type: "industry_scored"; industryInstanceId: string; ownerPlayerId: string; points: number }
  | { type: "merchant_bonus_claimed"; playerId: string; merchantSpaceId: string; bonus: MerchantBonus }
  | { type: "merchant_develop_resolved"; playerId: string; merchantSpaceId: string; merchantSpaceIds?: string[]; industryTypes: IndustryType[]; specIds: string[] }
  | { type: "turn_advanced"; currentPlayerId: string; roundNumber: number }
  | { type: "turn_order_updated"; order: string[] }
  | { type: "negative_income_started"; playerId: string; amountOwed: number; incomePlayerIndex: number }
  | { type: "negative_income_resolved"; playerId: string; amountOwed: number; paid: number; victoryPointLoss: number; industryInstanceIds: string[] }
  | { type: "victory_points_changed"; playerId: string; delta: number; reason: string }
  | { type: "era_ended"; era: Era; score: EraScoreBreakdown }
  | { type: "game_ended"; winners: string[] }
  | { type: "loan_taken"; playerId: string }
  | { type: "scouted"; playerId: string };
```

服务端恢复存档和对外投影视图都通过 `eventLogValidation` 校验事件
`reason`、数值方向、收入轨位置和资源来源类型，避免被篡改或旧版日志把
非法事件泄露给前端。

## 11. 对外房间摘要

`GameState.createdAt` 和 `GameState.updatedAt` 使用 ISO 时间字符串，由服务端
创建房间、恢复旧存档和成功执行命令时维护；成功命令会把 `updatedAt`
推进到当前时间和既有活动时间中的较晚者，避免系统时钟回拨导致大厅排序倒退。
公开房间列表会暴露 `createdAt` 和 `updatedAt` 两个 ISO 时间戳，并用
`updatedAt` 倒序排列，让最近发生行动的房间优先出现在大厅，
但不把完整 `GameState` 暴露给大厅。

`GET /api/games` 返回的是公开房间摘要，不是完整 `GameState`。进行中房间只暴露
当前行动玩家、待决类型、当前连接的 Socket 数和已认证在线玩家席位；
已结束房间可暴露胜者与每名玩家当前 VP，但不暴露手牌、
session token、抽牌堆或待决金额等私有状态。Socket.IO 可通过 `games:list:get`
ACK 拉取同样 payload；创建房间或成功提交命令后，服务端也会广播 `games:list`，
用于打开中的大厅实时刷新。客户端加入、离开或断开房间时，`connectedClientCount`
和 `connectedPlayerIds` 也会随 `games:list` 更新；观察者只计入
`connectedClientCount`，不会出现在 `connectedPlayerIds` 中。客户端返回大厅或切换房间时，可通过 `game:leave`
ACK 显式解除当前 Socket 与旧房间/玩家视图的绑定，避免继续收到旧房间的
`game:state` 广播。手动加入玩家视图时，客户端只在 Socket.IO ACK 返回匹配的
`session.playerId` 后切换到该玩家；手动观察者加入只在 ACK 不带玩家 session 时切换到观察者视图：

```ts
interface GameSummary {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  playerNames: string[];
  playerCount: PlayerCount;
  roundNumber: number;
  era: Era;
  status: "playing" | "ended";
  variant?: GameVariant;
  connectedClientCount?: number;
  connectedPlayerIds?: string[];
  currentPlayerId?: string;
  pendingDecision?: { type: "negative_income" | "merchant_develop"; playerId: string };
  winners?: string[];
  victoryPointsByPlayer?: Record<string, number>;
}
```

## 12. 实现时最容易漏的规则

- 每个行动都弃 1 张牌，Pass 也弃牌。
- 第一轮 Canal Era 每人只有 1 个行动，但回合结束仍补牌到 8。
- 设置时每名玩家有 1 张额外面朝下弃牌。
- 只有 Build 需要特定牌。
- 玩家网络不是只包含有产业的城市；自己连接牌相邻的两端地点也属于网络。
- 连通路径使用所有玩家的连接牌。
- 煤从最近连通煤矿取；铁可从任意铁厂取；自己的啤酒不用连通。
- 从煤市场买煤必须连到外部市场；从铁市场买铁不用连通。
- VP 在时代结算时得，不在产业翻面时得；收入在翻面时立即提升。
- Sell 一个行动可以卖多个产业。
- 每次出售只面对一个商人牌；商人啤酒与该商人牌绑定。
- Rail Era 可一次 Network 建 2 条铁路，但每条铁路单独放置、单独消耗煤。
- Canal Era 每玩家每地点最多 1 个产业；Rail Era 可多个。
- Canal 结算后只移除版图上的 Level 1 产业，Level 2+ 留下且若已翻面可在 Rail 结算再得分。
- 未建在玩家板上的 Canal-only 低级产业牌到 Rail Era 不能建，通常需要 Develop 跳过；Level 1 Pottery 是例外，可在 Rail Era 建。
- 带 lightbulb 禁止符号的 Pottery 不能 Develop。
- 对手的煤矿/铁厂只有在对应资源在整个版图和市场中都为 0 时才可 Overbuild。
- 行动花费进入本轮花费统计；收入阶段付款不是行动花费，不影响下轮顺位。

## 13. 可选：入门局变体

入门局只玩 Canal Era。完成 Canal Era 正常结算后，追加：

- 每 £4 现金得 1 VP，最多 15 VP。
- 按收入等级得/失 VP；负收入会扣分。
- Level 2 或更高的产业牌再计一次产业 VP。

该规则作为可选变体实现，不混入标准规则。当前实现已将其接入为
`introductory_canal_only`：

- `createGame({introductoryCanalOnly: true})` 或创建房间 payload 中的
  `introductoryCanalOnly: true` 会启用该变体。
- 变体局仍完整执行 Canal Era、末轮收入和 Canal Era 普通计分。
- Canal 结算后直接结束游戏，不重建 Rail deck，也不进入 Rail Era。
- 额外计分事件使用 `introductory money scoring`、
  `introductory income scoring` 和 `introductory industry scoring` reason，
  以便日志、投影和持久化可审计。

```ts
interface VariantConfig {
  introductoryCanalOnly?: boolean;
  extraScoring?: {
    cashToVp?: { cashPerVp: 4; maxVp: 15 };
    incomeLevelToVp?: boolean;
    scoreLevel2PlusIndustriesAgain?: boolean;
  };
}
```

## 13. 静态数据审计状态

当前实现已把以下静态数据录入 `staticConfig`，并通过 `tests/staticData.spec.ts`
中的 manifest 测试固定；`tests/legacyStaticDataParity.spec.ts` 还会把这些核心静态数据
同旧版 `js/gameData.js` 原型做迁移一致性核对。`staticConfig.audit`
同步记录每类数据的规则书页码、来源、测试覆盖和审计状态，避免“已固定的
manifest”和“仍待逐面人工核对”的边界只存在于文档里：

1. 所有城市：`id`、显示名、区域、建筑槽位和允许产业类型。
2. 所有连接线：两个端点、是否支持 canal/rail、特殊农场酒厂连接，以及按人数启用/停用的高人数商人端点连接。
3. 所有商人空间：地点、人数限制、奖励、是否提供煤市场连接。
4. 所有商人牌：人数限制、产业图标、是否空白。
5. 全部卡牌：类型、位置或产业、人数限制。
6. 全部产业牌模板：类型、等级、数量、时代限制、现金/煤/铁成本、卖出所需啤酒、翻面收入、VP、连接图标、初始资源、是否可 Develop。
7. 收入轨每一格：位置到收入等级的映射。
8. 官方物理组件清单：版图、玩家板、人物/收入/VP 标记、连接牌、产业牌、卡牌、商人牌、资源件、钱币和未使用空白牌。

当前 `staticConfig.audit` 中已标记为 `manifest_locked` 的项目：

- `components`
- `setupAndTurnRules`
- `markets`
- `incomeTrack`

当前 `staticConfig.audit` 中仍标记为
`manifest_locked_face_audit_pending` 的项目：

- `locationsAndSlots`
- `linkLines`
- `regularCards`
- `wildCards`
- `industryTiles`
- `merchantTiles`

本轮重新渲染并抽取了本地官方 PDF 全部 `12` 页。`staticConfig.audit.rulebookPages`
中的页码均来自这些页面：第 `1` 页组件清单，第 `4-5` 页设置和版图/玩家板示例，
第 `6-7` 页回合与时代维护，第 `8-12` 页动作、资源、网络和变体规则。规则书图片
对若干牌面和玩家板只是缩略或局部示例，因此不能替代最终实体/高清素材逐面核对。

### 13.1 官方组件清单核对

已用本地官方 PDF `Brass-Birmingham-Rulebook-2018.11.20-highlights.pdf`
核对以下页面，并将结果记录到 `staticConfig.components` 和
`tests/staticData.spec.ts`：

- 第 1 页组件清单：`1` 块版图、`4` 张玩家板、`4` 张人物牌、每色 `14` 条连接牌、每色 `45` 张产业牌、`64` 张位置/产业牌、`8` 张万能牌、`9` 张商人牌、`18` 个铁、`30` 个煤、`15` 个啤酒、`77` 个钱币，以及 `3` 张未使用空白牌。
- 第 4 页设置：少于 `4` 人时移除高人数卡牌和商人牌；商人啤酒、煤市场和铁市场按设置填充；通用供应是无限的，因此物理资源件数量只作为组件审计数据，不作为规则引擎资源上限。
- 第 4 页 Location Banners：`2` 人局不使用蓝色和青绿色位置牌。当前数据中蓝色示例牌为 Stoke-on-Trent，对应 `staffordshire`；青绿色示例牌为 Derby，对应 `derbyshire`。因此 `2` 人位置牌排除 `staffordshire` 和 `derbyshire`，`3` 人位置牌排除 `derbyshire`，`4` 人使用全部位置牌区域。
- 第 5 页玩家设置：每位玩家初始 `£17`、起手 `8` 张牌、另抽 `1` 张面朝下弃牌、收入标记在 `10` 格、VP 在 `0`。
- 第 6 页回合结构：`4/3/2` 人每时代分别为 `8/9/10` 轮，首个 Canal 轮每人只执行 `1` 个行动，之后每回合 `2` 个行动。

本轮审计使用 `pdfplumber` 抽取第 1、4、5、6 页文本，并用 Poppler 渲染前 6 页 PNG 抽样核对页面可读性。以上项目已经有自动化回归测试覆盖：

- `tests/staticData.spec.ts`：组件清单、卡牌人数分布、位置 banner 对应人数、连接线人数启用状态、商人牌数量、市场初始空位、核心规则常量、收入轨。
- `tests/setup.spec.ts`：起手 `8` 张、每人 `1` 张面朝下弃牌、初始现金/收入/VP、商人空间、当前人数商人牌精确启用集合、市场初始化、随机初始顺位。
- `tests/era.spec.ts`：`4/3/2` 人每时代 `8/9/10` 轮、首个 Canal 轮单行动、后续回合双行动、终局最后一轮不收收入。
- `tests/roundIncome.spec.ts`：负收入短缺时只允许移除产业牌、按建造现金成本半价向下取整、够付后停止、剩余短缺扣 VP。

### 13.2 官方动作规则核对

已用本地官方 PDF `Brass-Birmingham-Rulebook-2018.11.20-highlights.pdf`
抽取第 7-12 页并对照当前规则引擎测试。以下不是牌面逐面审计，而是动作规则与结算规则的页码级核对：

- 第 7 页 End of Canal & Rail Era：连接按两端地点图标计分、已翻面产业计分、未翻面产业不计、Canal 结算移除版图 Level 1 产业、补商人啤酒、洗弃牌进入 Rail deck、终局按 VP/收入/现金破平。对应 `tests/era.spec.ts`。
- 第 8 页 Game Play Concepts：翻面触发、收入前进“格”而非等级、玩家网络定义、全玩家连接形成连通路径、煤按最近连通来源/煤市场、铁不需连通、啤酒来源和对手酒厂连通限制。对应 `tests/resourceSources.spec.ts`、`tests/network.spec.ts`、`tests/sell.spec.ts`。
- 第 9 页 Build Action：Build 是唯一需要特定牌的行动；位置牌/产业牌/Wild 牌限制；纯槽位优先；最低级可用产业牌；Build 时支付成本并消耗煤/铁；煤矿/铁厂仅在建造当次卖入市场；农场酒厂建造限制和特殊连接。对应 `tests/actions.spec.ts`、`tests/clientBuildSlots.spec.ts`、`tests/resourceSources.spec.ts`。
- 第 10 页 Build Continued / Sell Action：Canal 每玩家每地点最多 1 个产业，Rail 可多个；自己可用更高级同产业 overbuild，替换对手仅限资源耗尽的煤矿/铁厂；Sell 需连接对应商人牌、消耗啤酒、可在一个 Sell 行动内重复出售，商人啤酒奖励按 Gloucester/Oxford/Nottingham/Shrewsbury/Warrington 生效。对应 `tests/actions.spec.ts`、`tests/sell.spec.ts`、`tests/clientSellOptions.spec.ts`。
- 第 11 页 Loan / Develop / Scout / Network：贷款拿 `£30` 且收入后退 `3` 个收入等级到目标等级最高格，不能低于 `-10`；Develop 移除 1-2 个最低级可用产业牌并每个耗 1 铁，lightbulb Pottery 不能 Develop；Scout 弃 3 张并拿 2 张 Wild，已有 Wild 时禁止；Network 的 canal/rail 数量、成本、单 rail 不耗啤酒、双 rail 耗啤酒、每条 rail 单独耗煤和网络延伸要求。对应 `tests/actions.spec.ts`、`tests/network.spec.ts`、`tests/clientNetworkOptions.spec.ts`。
- 第 12 页 Things to Remember / Introductory Game：每行动弃 1 张牌、同一回合可重复行动、只有 Build 需要匹配的特定牌、Wild 牌弃出后回公共池、Build 地点网络例外、自己酒厂啤酒不限连接、对手酒厂啤酒必须连通、Level 1 Pottery 可在 Rail Era 建造、入门局是独立变体。标准规则部分对应 `tests/actions.spec.ts`、`tests/sell.spec.ts`、`tests/era.spec.ts`；Level 1 Pottery 是唯一 Rail 可建 Level 1 产业的静态数据例外，对应 `tests/staticData.spec.ts`；入门局变体作为可选 `introductory_canal_only` 规则，对应 `tests/era.spec.ts`、`tests/setup.spec.ts`、`tests/server/gameStore.spec.ts`、`tests/server/createServer.spec.ts`。

### 13.3 发布前逐面核对清单

以下项目仍需要真人对照官方实体或高清 PDF 逐面确认。完成后应把结果同步到 `staticConfig` 的 manifest 测试，而不是只更新文档：

为避免逐面核对只停留在散文 checklist，`src/common/faceAudit.ts` 提供
`buildFaceAuditChecklist()`，会从当前 `staticConfig` 派生每个待核对对象的
机器可读清单；`buildFaceAuditChecklistExport()` 还会按审计 area 输出数量、
规则书页码、来源、测试覆盖和字段名摘要，并在导出根节点携带 `version`、
`checklistFingerprint` 和 `checklistItemCount`，方便审计证据精确引用当前
清单版本。服务端通过
`GET /api/face-audit-checklist` 暴露同一份只读公共清单。`tests/faceAudit.spec.ts`
会固定清单覆盖范围、数量和关键字段，`tests/server/createServer.spec.ts`
会固定 HTTP 响应不会泄露游戏私有状态。前端 `Rules Data Face Audit`
面板会从该端点加载清单，并把逐项 reviewed 进度保存在浏览器本地存储中；
该进度也可导出/导入为 JSON 工件，方便跨浏览器或提交审计记录。导出的
工件包含当前清单指纹，导入时会拒绝与当前 `staticConfig` 清单不匹配的旧
工件。服务端还通过 `GET /api/face-audit-review-template` 输出同一指纹下的
可填写 JSON 审计记录模板，包含每个条目的 `reviewStatus`、审阅人、时间、
证据引用和备注字段，以及按区域/全局汇总的未审阅、匹配、差异和需补参考
数量。浏览器 Face Audit 面板可加载单个 area 模板，并用审阅人、审阅时间、
官方组件来源和状态批量填充当前加载的 area artifact，填充时可选择生成
area 级 `official-component:<source>#<area>` 引用或逐项
`official-component:<source>#<area>:<item-id>` 引用；也可从完整或分区
review artifact 中把所有非 `unreviewed` 条目导回本地 reviewed 进度，减少手工
编辑每个条目的 JSON；status 结果中的每个 area 也会显示 area 级和逐项证据
覆盖摘要，并可直接请求 compact todo handoff、单区 todo summary 或逐项 review plan 来查看尚未完成的审计 area；
也可把 handoff JSON 与审阅人返回的分区 artifact 一起提交，直接汇总返回件
是否属于该 handoff 以及哪些 area 已 ready 或仍缺失。
浏览器面板中的 status、todo、单区 todo-summary、review plan、TSV、instructions 和 handoff 操作在
merge-artifact 输入为空时使用这些 public baseline GET；粘贴 review JSON 后则切换为
带提交工件进度的 POST。
`GET /api/face-audit-review-template/status` 会在不提交审阅工件时输出当前
全量未审 baseline 的全局和分区进度摘要。
`GET /api/face-audit-review-template/todo` 会输出当前 baseline 的 compact
todo handoff，包含每个未完成 area 的剩余数量、下一步和本地命令模板。
`GET /api/face-audit-review-template/todo-summary` 会在不提交审阅工件时输出当前
清单的计数版未完成基线，便于仪表盘或 CI 日志直接显示剩余 area 和 item 数量。
`GET /api/face-audit-review-template/:area/todo-summary` 会输出指定 area 的
计数版基线，直接标明该 area 是否 ready、仍未审、存在差异或需要更清晰官方参考。
`GET /api/face-audit-review-template/review-sheet` 会下载全量未审 baseline 的
TSV 审阅表，`GET /api/face-audit-review-template/:area/review-sheet` 会下载指定
area 的未审 baseline TSV 审阅表。
`GET /api/face-audit-review-template/review-plan` 会输出未提交审阅工件时的逐项
baseline 派工清单，`GET /api/face-audit-review-template/reviewer-instructions`
会下载全量 baseline reviewer instructions Markdown，
`GET /api/face-audit-review-template/:area/reviewer-instructions` 会下载指定
area 的 baseline 审阅说明 Markdown。
`GET /api/face-audit-review-template/handoff` 会下载完整 baseline reviewer handoff
JSON，包含 compact todo 以及每个未完成 area 的可填写分区 review artifact。
`GET /api/face-audit-review-template/:area` 会输出单个 area 的
分工审阅模板，`POST /api/face-audit-review-template/merge` 可把多个完整或
分区审阅工件合并回标准完整 review artifact，`POST /api/face-audit-review-template/status`
可直接输出这些工件的全局和分区进度摘要，`POST /api/face-audit-review-template/todo`
则输出只包含未完成 area 和下一步命令的简短人工交接工件，
`POST /api/face-audit-review-template/todo-summary` 则输出同一进度的计数版
`face_audit_review_todo_summary`，便于仪表盘或 CI 日志快速显示剩余工作量，
`POST /api/face-audit-review-template/:area/todo-summary` 则输出指定 area 的
`face_audit_area_review_todo_summary`，便于只查看某个审阅分工的剩余条目数、
下一步状态和证据覆盖计数，
`POST /api/face-audit-review-template/review-plan` 会把同一进度展开成逐项
派工清单，列出每个未完成条目的 label、expected fields、当前状态、证据引用
和下一步处理类型，
`POST /api/face-audit-review-template/review-sheet` 会把同一进度下载为 TSV
表格，便于导入电子表格做派工或离线追踪，
`POST /api/face-audit-review-template/:area/review-sheet` 会用同一列结构只下载
指定 area 的 TSV 表格，便于分区审阅人只编辑自己的行，
`POST /api/face-audit-review-template/apply-review-sheet` 可把编辑后的 TSV
按同一批 baseline review artifacts 回灌成完整 review JSON，
`POST /api/face-audit-review-template/reviewer-instructions` 会用同一批工件
下载 reviewer instructions Markdown，与 CI 交接包里的审阅说明保持一致，
`POST /api/face-audit-review-template/:area/reviewer-instructions` 会下载指定
area 的审阅说明 Markdown，与 CI 交接包里的
`face-audit-area-<area>-reviewer-instructions.md` 保持一致，
`POST /api/face-audit-review-template/handoff` 会进一步输出 compact todo
和每个未完成 area 的当前分区 review artifact，浏览器面板可直接把这些 area
artifact 加载回编辑框继续填写；`POST /api/face-audit-reviewer-handoff/verify`
可在接收交接包后重新校验其清单指纹、embedded todo 和每个分区工件仍互相
一致；`POST /api/face-audit-reviewer-handoff/response` 可把审阅人返回的
分区 review artifact 对照原 handoff 汇总为已 ready、仍未完成和仍缺失的
area 数量。填好的工件可提交到
`POST /api/face-audit-review-template/validate`，
服务端会按当前清单指纹重新校验条目完整性、重复/缺失项、状态值、审阅人、
时间戳、证据引用和差异说明，并重新计算 `ready_to_lock`、`has_differences`
等完成度摘要；`POST /api/face-audit-review-template/ready` 使用同一套严格
完成度门槛，要求所有条目均匹配官方牌面，适合作为发布或锁定审计状态前的
服务端检查。工件必须先在 `evidenceSources` 中声明每个官方组件来源的 `id`、
`label`、`sourceType` 和 `citation`；草稿校验阶段可选填写 `locator` 记录具体审阅
文件、URL、页码或归档路径，填写 `contentHash` 时必须使用 `sha256:<64 hex>`、
`sha1:<40 hex>` 或 `md5:<32 hex>`，ready/lock 阶段则要求每个已使用来源至少包含
`locator` 或 `contentHash` 之一；可先用 `npm run face-audit:hash-source --
./path/to/official-component-photos.zip ./path/to/board.png` 对本地官方组件照片、
PDF 或归档文件生成 `face_audit_evidence_source_hashes`，再把输出的
`locator` 和 `contentHash` 填回 review artifact 的 `evidenceSources`；也可用
`npm run face-audit:source-template -- official_high_res_component_image
./path/to/official-component-photos.zip ./path/to/board.png` 直接生成包含稳定
source id、label、sourceType、citation、locator、contentHash 和空 notes 的完整
`evidenceSources` 模板；选定 source id 后，可用
`npm run face-audit:evidence-ref-template -- photo-set regularCards` 生成 area 级
`evidenceRef`，或用
`npm run face-audit:evidence-ref-template -- photo-set regularCards items` 为该
area 的每个清单条目生成逐项 `evidenceRef` 列表；如果审阅仍在进行中，或需要
记录与官方组件证据的差异，可用
`npm run face-audit:template-with-sources -- ./path/to/evidence-sources.json`
或
`npm run face-audit:area-template-with-sources -- regularCards ./path/to/evidence-sources.json`
生成已带 `evidenceSources` 但仍全量 `unreviewed` 的空白模板；当真人已经确认某个 area
全部条目均与官方组件证据匹配后，可用
`npm run face-audit:area-match-template -- regularCards ./path/to/evidence-sources.json photo-set Ada 2026-07-10T00:00:00.000Z`
把包含 `evidenceSources` 的 source-template 或 review artifact 转成已填好的
area review artifact，也可在末尾追加 `items` 为每个条目生成逐项引用；当真人已经完成
全量清单核对后，也可用
`npm run face-audit:review-match-template -- ./path/to/evidence-sources.json photo-set Ada 2026-07-10T00:00:00.000Z`
直接生成完整 review artifact，供 `ready`、`lock-preview` 和 `lock-artifact`
继续使用；如果不同 area 使用不同官方证据文件，可用
`npm run face-audit:source-ids-by-area-template -- ./path/to/evidence-sources.json cards-source industryTiles=tiles-source linkLines=board-source locationsAndSlots=board-source`
先生成覆盖全部 area 的 `source-ids-by-area.json` 映射，再用
`npm run face-audit:review-match-template-by-area -- ./path/to/evidence-sources.json ./path/to/source-ids-by-area.json Ada 2026-07-10T00:00:00.000Z`
直接生成完整 review artifact，其中 `source-ids-by-area.json` 是覆盖全部
`industryTiles`、`linkLines`、`locationsAndSlots`、`merchantTiles`、`regularCards`
和 `wildCards` 的 area 到 source id 映射，也可在末尾追加 `items` 输出逐项
证据引用。服务端也提供 `POST /api/face-audit-evidence-ref-template`、
`POST /api/face-audit-source-ids-by-area-template`、
`POST /api/face-audit-review-template/:area/match` 和
`POST /api/face-audit-review-template/match`，浏览器 Face Audit 面板可用同一套
reviewer/source metadata 生成 evidence refs、可保存并可重新载入的
`source-ids-by-area.json`、单区匹配 artifact 或完整匹配
artifact；浏览器面板也可直接选择官方组件文件，用 Web Crypto 计算 `sha256`
并生成 source artifact，或粘贴 CLI 生成的 source artifact 后把某条来源同步到
表单字段；生成完整匹配 artifact 时，浏览器面板也可为每个 area 单独选择
source id 并提交同一 `sourceIdsByArea` 映射；也可把当前审阅进度下载为 TSV
review sheet，导入编辑后的 TSV 重新生成完整 review JSON，下载 reviewer
instructions Markdown，下载指定 area 的 reviewer instructions Markdown，
把 reviewer handoff 生成为可直接交给 CLI 校验的 JSON 文件，
并把 handoff 内每个未完成 area 的 review artifact 单独下载为 JSON 文件。
逐项 `evidenceRef` 必须使用
`official-component:<source>#<area>` 引用覆盖某个审计 area 的已声明官方组件
证据集，或使用 `official-component:<source>#<area>:<item-id>` 引用单个条目的
官方组件证据；其中 `<source>`、`<area>` 和可选 `<item-id>` 必须分别匹配已
声明来源和当前清单条目；仍为 `unreviewed` 的条目必须保持审阅人、时间戳、
证据引用和备注为空，避免把残留元数据误算为人工核对证据。ready/lock
检查会拒绝未被任何证据引用使用的已声明来源，最终紧凑 lock evidence 也只保留
至少被一个 area evidence ref 引用过的来源记录。lock preview 和紧凑 lock evidence
的每个 area 还会记录 evidence ref 总数、area 级引用数、逐项引用数和逐项覆盖 item 数。
`POST /api/face-audit-review-template/lock-preview` 在 ready gate
通过后返回同一份审计状态锁定预览，方便浏览器面板和联机服务端共享发布前
记录；`POST /api/face-audit-review-template/lock-artifact` 在同一 ready gate
通过后只返回紧凑 `face_audit_lock_evidence`，不回传 185 个逐项 review
条目；`POST /api/face-audit-lock-artifact/verify` 可校验该紧凑证据仍绑定
当前清单或刚锁定后的清单迁移。命令行也提供同一套校验入口：`npm run face-audit:checklist`
导出当前清单，`npm run face-audit:template` 导出完整可填写模板，
`npm run face-audit:area-template -- regularCards` 可按单个 area 导出分工审阅模板，
`npm run face-audit:merge -- ./path/to/regular-cards-review.json ./path/to/industry-tiles-review.json`
会把多个完整或分区审阅工件合并回标准完整 review artifact，供后续 ready/lock
命令继续使用。`npm run face-audit:status` 可在尚无任何审阅工件时输出当前
全量未审基线报告；`npm run face-audit:status -- ./path/to/regular-cards-review.json ./path/to/industry-tiles-review.json`
则会合并已有完整或分区审阅工件，并在不要求 ready gate 通过的情况下，输出带清单/审阅指纹的版本化
`face_audit_review_status` artifact，包含每个 area 的已审、匹配、差异、需补参考和
未审数量、顶层 area 完成状态计数、审阅人/审阅时间范围交接信息、已引用和未使用的
证据来源 id、area 级和逐项证据引用覆盖摘要，以及仍未审、存在差异、需补参考的逐项 item key，
方便按分工追踪人工核对进度并在 PR/CI 中归档。`npm run face-audit:todo`
使用同样的输入，但输出更短的 `face_audit_review_todo` artifact，只保留尚未
完成的 area、剩余数量、下一批需要检查的 item key，以及生成分区模板或已确认
匹配分区工件的命令；顶层 `commands` 还会给出完整模板、完整匹配模板和
按 area source id 映射的完整匹配模板命令，方便一个审阅人完成全量核对后
直接生成最终 review artifact。追加 `--summary` 时会输出计数版
`face_audit_review_todo_summary`，不包含命令模板或逐项 item key，适合快速查看
pending area、pending item 和完成度；同时追加 `--area <area>` 时会输出指定
area 的 `face_audit_area_review_todo_summary`，便于只检查某个审阅分工是否
ready、还剩多少条目、下一步是继续审阅、解决差异还是补充官方参考。`npm run face-audit:review-plan`
也使用同样的输入，但输出 `face_audit_review_plan` artifact，把所有未完成
条目按 area 分组列全，包含 item key、label、expected fields、当前 review
状态、现有 evidence ref、备注和逐项 next step，便于多个审阅人不打开完整
editable handoff JSON 也能分配逐面核对任务。`npm run face-audit:review-sheet`
也接受同样的可选 review artifact 输入，但输出 TSV 表格，包含每个 checklist
条目的 area、item id、item key、label、expected fields、当前 review 状态、
下一步、审阅人、时间戳、evidence ref 和 notes，方便导入电子表格做派工或离线
跟踪；`npm run face-audit:area-review-sheet -- <area>` 会输出同样列结构但只包含
指定 area 的 TSV，方便分区审阅人编辑后仍通过同一个 apply-review-sheet 回灌；
`npm run face-audit:apply-review-sheet -- ./path/to/face-audit-review-sheet.tsv ./path/to/face-audit-review.json`
可把编辑后的 TSV 按同一批 baseline artifact 回灌成完整 review JSON，继续交给
`validate`、`ready`、`lock-preview` 或 `lock-artifact`；`npm run face-audit:reviewer-instructions`
可用同一批可选 review artifact 直接输出 reviewer instructions Markdown，与 CI
交接包中的 `face-audit-reviewer-instructions.md` 保持一致；`npm run face-audit:area-reviewer-instructions -- <area>`
会输出单个 area 的审阅说明 Markdown，与 CI 中
`face-audit-area-<area>-reviewer-instructions.md` 保持一致；如果该 area
已经 `ready_to_lock`，则输出无需继续审阅的说明。服务端的
`GET /api/face-audit-review-template/status`、
`GET /api/face-audit-review-template/todo`、
`GET /api/face-audit-review-template/review-plan`、
`GET /api/face-audit-review-template/review-sheet`、
`GET /api/face-audit-review-template/:area/review-sheet`、
`GET /api/face-audit-review-template/reviewer-instructions` 和
`GET /api/face-audit-review-template/:area/reviewer-instructions`、
`GET /api/face-audit-review-template/handoff` 提供未提交
审阅工件时的 baseline 状态、todo、派工清单、TSV、Markdown 和 handoff 下载；
`POST /api/face-audit-review-template/status`、
`POST /api/face-audit-review-template/todo`、
`POST /api/face-audit-review-template/review-plan`、
`POST /api/face-audit-review-template/review-sheet` 提供带
review artifact 进度的状态、todo、逐项派工清单和 TSV 下载，
`POST /api/face-audit-review-template/:area/review-sheet` 提供同样的单区 TSV 下载，
`POST /api/face-audit-review-template/apply-review-sheet` 提供同样的 TSV 回灌，
`POST /api/face-audit-review-template/reviewer-instructions` 和
`POST /api/face-audit-review-template/:area/reviewer-instructions` 提供同样的
Markdown 下载，`POST /api/face-audit-review-template/handoff` 提供同样的
handoff JSON 下载；
最终 ready/lock 仍以 JSON review artifact 为准。`npm run face-audit:ci-artifacts -- ./face-audit-artifacts`
会把 `face-audit-ci-manifest.json`、`face-audit-review-status.json`、
`face-audit-review.json`、`face-audit-review-todo.json`、
`face-audit-review-plan.json`、`face-audit-review-sheet.tsv`、
`face-audit-reviewer-handoff.json` 和 `face-audit-reviewer-instructions.md`
写入指定目录，
同时为每个未完成 area 额外写出独立的
`face-audit-area-<area>-review.json` 和
`face-audit-area-<area>-review-sheet.tsv`、
`face-audit-area-<area>-todo-summary.json`，以及可单独分发给该 area 审阅人的
`face-audit-area-<area>-reviewer-instructions.md`；也可在目录参数后追加一个或多个
review artifact，让 CI 归档合并后的审计状态、完整 review artifact、未完成清单、逐项派工计划、
TSV 派工表、总 handoff、人类可读审阅步骤、可直接分发填写的分区模板和每个
未完成 area 的逐区 TSV、计数版摘要与分区审阅说明。`npm run verify`
会先用临时目录运行 `face-audit:ci-artifacts-self-check`，确认同一套
CI artifact 生成和目录自检可以无残留通过。GitHub Actions 在 `npm run verify`
通过后会运行正式导出命令，并以
`face-audit-ci-artifacts` artifact 上传该目录，供审阅人直接从对应 CI run 下载
当前审计状态、完整 review artifact、未完成清单、逐项派工计划、TSV 派工表、落盘 manifest、未完成 area 的独立分区模板、逐区 TSV、逐区 summary 和逐区审阅说明。该命令的
stdout manifest 也会输出 review 指纹、已审/未审条目数、pending/ready area
数量、每个未完成 area 的剩余条目数，以及每个归档文件的 sha256 contentHash；
stdout manifest 会与落盘 manifest 保持一致，便于只看 CI 日志时判断审计工作量并核对下载内容。Actions
会在上传 artifact 前先运行同一套目录自检，避免缺文件或 handoff/area
内容不一致的审计包被归档。下载 artifact 目录后也可先运行
`npm run face-audit:verify-ci-artifacts --
./face-audit-artifacts`，确认 manifest、核心 JSON、TSV review sheet、审阅说明、handoff 包和每个未完成
area 的分区 review artifact、逐区 summary 与逐区审阅说明都存在且互相一致；自检还会把 status、todo、
review-plan、逐区 todo-summary artifact 和逐区审阅说明与 reviewer handoff 反推结果交叉比对，避免被编辑过的
摘要、说明和实际要分发填写的 area 文件漂移，并用 `face-audit-review.json` 重建
TSV review sheet，再把 TSV 回灌到同一份 review JSON，避免表格派工文件与
JSON 工件不同步。
`npm run face-audit:handoff -- ./path/to/regular-cards-review.json ./path/to/industry-tiles-review.json`
会在同一进度基础上输出 `face_audit_reviewer_handoff` artifact，内含 compact
todo 和每个未完成 area 的当前分区 review artifact；这些分区工件会保留已声明
的 `evidenceSources`、已完成的逐项审阅、差异和需补参考状态，方便新的审阅人
直接继续填写，而不需要为每个 area 重新运行模板命令。收到别人生成的交接包后，
可用 `npm run face-audit:verify-handoff -- ./path/to/face-audit-reviewer-handoff.json`
确认该包仍绑定当前清单，并且顶层 todo、分区 todo 和分区 review artifact 没有
互相漂移。审阅人返回一个或多个分区工件后，可用
`npm run face-audit:handoff-response -- ./path/to/face-audit-reviewer-handoff.json ./path/to/returned-area-review.json`
确认返回的 area 属于该 handoff，并汇总哪些已 `ready_to_lock`、哪些仍未完成、
哪些 handoff area 尚未返回。
`npm run face-audit:validate -- ./path/to/face-audit-review.json` 在本地或 CI
中校验填好的工件结构；`npm run face-audit:ready -- ./path/to/face-audit-review.json`
则是更严格的发布门槛，要求所有条目均为 `matches_official_face`、无差异且无
待补参考，才允许后续把 `staticConfig.audit` 的逐面审计状态锁定。
`npm run face-audit:lock-preview -- ./path/to/face-audit-review.json` 会在同一
ready gate 通过后输出每个 face-audit area 从
`manifest_locked_face_audit_pending` 锁到 `manifest_locked` 的机器可读预览、
审阅人、证据引用和审阅时间范围，供 PR/CI 记录使用。该预览同时包含
`checklistFingerprint` 和 `reviewFingerprint`：前者锁定当前 `staticConfig`
待审清单版本，后者锁定已规范化的人工审阅证据本身。
`npm run face-audit:lock-artifact -- ./path/to/face-audit-review.json` 会在同一
ready gate 通过后输出更精简的 `face_audit_lock_evidence` JSON，只包含指纹、
完成度和各 area 的锁定摘要，不包含 185 个逐项 review 条目，适合提交到 PR
或 CI 产物中作为人工审阅证据索引；该工件会保留规范化 `evidenceSources`
来源注册表，方便之后只凭紧凑证据追溯官方组件来源。`npm run face-audit:verify-lock-artifact
-- ./path/to/face-audit-lock-artifact.json` 会反向校验这份紧凑证据是否仍绑定
当前清单，或绑定刚把逐面审计 area 从
`manifest_locked_face_audit_pending` 改成 `manifest_locked` 后的同一份清单
迁移。`npm run face-audit:release-gate -- ./path/to/face-audit-lock-artifact.json`
用于发布/CI 门槛：当前所有逐面 area 仍为 pending 时可无证据通过；一旦任何
逐面 area 被锁为 `manifest_locked`，则必须整批锁定并提供可验证的
`face_audit_lock_evidence`。服务端同样提供 `POST /api/face-audit-release-gate`，
可提交 `{ "lockArtifact": ... }` 或空对象运行同一门禁；浏览器 Face Audit
面板可直接生成未完成条目的逐项 review plan，Lock Artifact 区域也可直接检查 release gate。以上命令和接口只是人工核对过程记录，不会直接改变
`staticConfig.audit` 的审计状态。

1. 全部 `64` 张 Location/Industry 普通牌的实体牌面：地点/产业、人数角标和数量分布。当前 `tests/staticData.spec.ts` 已固定普通牌人数前缀、地点/产业分布、连续 copy 编号和 `cardSpecs` 实体 `id` 展开；仍需人工逐面确认牌面地点/产业与官方实体/高清 PDF 完全一致。
2. 全部 `8` 张 Wild 牌：`4` 张 Wild Location 与 `4` 张 Wild Industry。当前 `tests/staticData.spec.ts` 已固定 Wild 牌数量和 `wild-location-1..4` / `wild-industry-1..4` 实体 `id` 展开；仍需人工确认牌面类型和数量。
3. 地图上 `20` 个城市的全部产业槽位图标、混合槽位、地点 banner 颜色和印刷连接图标。
4. 全部 `39` 条连接线的端点、canal/rail 支持、人数适用性，以及 Cannock 北侧酒厂、Kidderminster-Worcester 南侧酒厂这类特殊连接。当前 `tests/staticData.spec.ts` 已固定连接线端点、canal/rail 支持、特殊 farm brewery 连接和高人数商人端点导致的连接线启用/停用清单；仍需实体或高清 PDF 逐线目视确认端点和印刷线型。
5. 全部 `45` 张每色产业牌的等级、数量、建造时代、现金/煤/铁成本、出售啤酒需求、翻面收入、VP、连接图标、产出资源和禁止 Develop 标记。当前 `tests/staticData.spec.ts` 已固定每类型数量、每等级 `count`、实体牌 `id` 展开和玩家板顺序；仍需人工逐面确认这些字段与官方实体/高清 PDF 完全一致。
6. 全部 `9` 张商人牌的产业图标、空白牌、人数角标，以及 Gloucester/Oxford/Shrewsbury/Warrington/Nottingham 的奖励。当前 `tests/staticData.spec.ts` 已固定商人牌数量、空白牌、ID 中的商人地点前缀、产业图标后缀、人数角标和商人奖励 manifest；仍需人工逐面确认牌面与官方实体/高清 PDF 完全一致。
7. 规则书以外的 UI 坐标、图像裁切和素材映射；这些不应进入规则引擎，可另放渲染配置。
