# CLAUDE.md — TWODRAPES 订单工具

## 项目概述

Node.js + Express + SQLite 本地服务器工具，用于窗帘/帘布定制产品的订单管理、成本核算、利润计算和工厂反馈。

三端架构，共用一个 SQLite 数据库：
- **独立站端** `:8080` — Shopify 渠道运营（成本核算、下单、利润计算）
- **亚马逊端** `:8082` — Amazon 渠道运营（与独立站端共用同一套前端代码）
- **管理端** `:8081` — 领导视图（订单汇总、利润计算、成本反馈、公式参数控制）

两个运营端共用 `public/` 目录，通过 `location.port` 运行时检测渠道（`shopify` / `amazon`）。修改 `public/` 中的任意文件，两个端口同步生效。

## 目录结构

```
server.js                    # 入口，创建三个 Express app 并挂载路由
src/
  config.js                  # 功能开关
  db.js                      # SQLite 初始化、迁移、通用查询
  formulas.js                # 核心成本计算引擎（calcItem）
  routes/                    # API 路由（挂载到 /api）
    health.js, globals.js, materials.js, products.js,
    rules.js, calc.js, orders.js, import-export.js,
    factory.js, backups.js
  services/                  # 业务逻辑
  utils/
    helpers.js               # now(), num(), getGlobals(), context(), sendCsv, sendHtmlXls
    orders.js                # saveOrder, recalculateOrderById, orderRows
public/                      # 运营端前端（独立站端 + 亚马逊端共用）
public-factory/              # 管理端前端
data/                        # SQLite 数据库、备份、导出
scripts/                     # 数据库初始化和迁移脚本
```

## 代码约定

### 路由（src/routes/）

- 每个模块导出 `express.Router()`，在 `server.js` 中挂载到 `/api`
- 命名用复数名词：`/orders`, `/products`, `/fabrics`
- 子资源嵌套：`/orders/:id/logistics`, `/order-items/:id/option`, `/orders/:id/status`
- 路由是薄封装，业务逻辑放 `services/` 或 `utils/`
- 每个 handler 内 try/catch，错误返回 `res.status(4xx).json({ ok: false, error: message })`
- 成功响应：GET 列表直接 `res.json(data)`，其他用 `{ ok: true, ...payload }`

### 数据库（src/db.js）

- 使用 Node.js 内置 `node:sqlite`（`DatabaseSync`，同步 API）
- WAL 模式，外键开启
- 查询用 `db.prepare(sql).run/get/all()`，参数用 `?` 占位符
- Upsert 用 `ON CONFLICT ... DO UPDATE SET`
- 事务用 `db.transaction(fn)` 包装（BEGIN IMMEDIATE / COMMIT / ROLLBACK）
- `tableAll(name)` 提供通用表读取，有白名单校验

### 前端

- 运营端：`public/index.html` + `public/js/api.js` + `public/js/main.js` + `public/css/app.css`
- 管理端：`public-factory/index.html` + `public-factory/js/api.js` + `public-factory/js/factory.js` + `public-factory/css/factory.css`
- 渠道检测在 `public/js/main.js` 顶部：`const ORDER_CHANNEL = (location.port === '8082' || ...) ? 'amazon' : 'shopify';`
- 运营端不包含参数设置页面（参数控制仅在管理端）

### 数值计算

- 所有金额/数量计算用 `n()` 或 `num()` 安全转换，避免 NaN
- 汇率固定 6.8，PayPal 手续费固定 4.4%

## 常用开发任务

### 新增 API 路由

1. 在 `src/routes/` 新建或编辑路由文件
2. 导出 `express.Router()`
3. 在 `server.js` 中 `require` 并挂载到 `app`（独立站端）、`factoryApp`（管理端）、`amazonApp`（亚马逊端）

### 修改成本计算公式

- 核心在 `src/formulas.js` 的 `calcItem()`
- 入参是产品、面料、内衬、选项等配置
- 返回完整成本拆解和警告信息

### 添加数据库字段

1. 在 `src/db.js` 的 `CREATE TABLE` 中添加列
2. 在 `scripts/migrations/` 添加迁移脚本（如需兼容旧数据）
3. 更新相关路由和前端

### 添加全局参数

- 通过 `globals` 表（key-value）
- 用 `getGlobals()` 读取，`upsertGlobal()` 写入
- 前端在"默认参数"页面管理（运营端）或"参数设置"页管理（管理端）

## 关键文件索引

| 文件 | 作用 |
|------|------|
| `server.js` | 入口，三端 app 创建和路由挂载 |
| `src/db.js` | 数据库初始化、迁移、通用查询 |
| `src/formulas.js` | 成本计算核心算法 |
| `src/utils/helpers.js` | 通用工具函数 |
| `src/utils/orders.js` | 订单 CRUD 和导入 |
| `src/config.js` | 功能开关 |

## 注意事项

- 不要修改 `node_modules/`
- SQLite experimental warning 是 Node 24 正常提示，可忽略
- 前端 `localStorage` 只用于订单草稿，正式数据在 SQLite
- 管理端不暴露运营操作细节（如 Shopify 配置等）
- 运营端修改代码后两个端口（8080/8082）同步生效，无需重启
