---
name: tencentmap-jsapi-gl-skill
description: 腾讯地图 JavaScript GL（JSAPIGL）开发指南。适用于地图应用或者工具的编写。在编写、审查或调试使用腾讯地图 API的代码时应运用此技能。适用于涉及地图初始化、覆盖物展示、图层控制、事件处理、控件交互、可视化渲染、地图工具、检索、路线规划、查地址、行政区划、ip定位、几何计算、三维模型展示、性能优化的任务。当用户提及 腾讯地图、 jsapi、jsapi-gl或相关地图开发需求时自动触发。
version: 1.0.4
metadata: { "openclaw": {} }
---

# 腾讯地图JSAPI GL开发技能

帮助用户使用腾讯地图 JavaScript API GL 进行地图功能开发，包含基础地图功能和数据可视化功能。

## 目录结构

- **Key 安全 / 代理服务转发**: `references/key-security.md`（Nginx 代理配置、前端改造、HTML Key 安全检查与固定提示文案、可视化图层示例、底图约束）

### API 文档

- **JS API 参考文档**: `references/jsapigl/docs/` (21个md文件)
  - 概述.md - API总览和索引
  - 地图.md - 地图核心类和配置
  - 点标记.md - 标注点相关API
  - 矢量图形.md - 折线、多边形、圆形、矩形、椭圆形等矢量图形
  - 文本标记.md - 文本标注API
  - DOM覆盖物.md - 自定义DOM覆盖物
  - 信息窗体.md - 信息窗口API
  - 点聚合.md - 点聚合功能
  - 控件.md - 地图控件
  - 自定义图层.md - 自定义栅格/矢量图层
  - 事件.md - 地图事件系统
  - 基础类.md - LatLng、Point等基础类
  - 室内图.md - 室内地图功能
  - 附加库：地图工具.md - 几何编辑器、测量工具
  - 附加库：几何计算库.md - 距离、面积计算
  - 附加库：服务类库.md - 地点搜索、路线规划等
  - 附加库：地图视角附加库.md - 观察者视角
  - 附加库：模型库.md - GLTF/3DTiles模型
  - 附加库：天气图层.md - 气象图层
  - 附加库：矢量数据图层.md - GeoJSON/MVT图层
  - 环境检测.md - 浏览器环境检测

- **可视化参考文档**: `references/visualization/docs/` (14个md文件)
  - 参考手册.md - 可视化API总览
  - 弧线图.md - 3D弧线/流向图
  - 散点图.md - 3D散点图
  - 热力图.md - 经典热力图
  - 蜂窝热力图.md - 蜂窝聚合热力图
  - 网格热力图.md - 网格聚合热力图
  - 轨迹图.md - 轨迹展示
  - 区域图.md - 区域轮廓图
  - 管道图.md - 3D管道图
  - 辐射圈.md - 辐射圈效果
  - 围墙面.md - 围墙面效果
  - 水晶体.md - 3D水晶体效果

  - 事件.md - 可视化事件系统
  - 基础类.md - 可视化基础类

### 示例代码

- **JS API Demos**: `references/jsapigl/demos/` (129个html文件)
  - 按功能分类：地图操作、点标记、文本标记、点聚合、折线、多边形、控件、信息窗口、服务类、个性化地图、几何计算、模型库、应用工具、自定义覆盖物、城市漫游等

- **可视化 Demos**: `references/visualization/demos/` (44个html文件)
  - 按图层类型分类：弧线图、散点图、热力图、轨迹图、蜂窝图、区域图、水晶体等

## Key 处理

按此顺序自动获取 Key：`Client(key=...)` → 已保存的 Key。各来源的 Key 会全部进入候选池。

1. **用户提供 Key**——先调用 `client.save_key("<key>")` 保存到本地配置，再执行主任务。保存后该 Key 自动进入候选池首位，后续请求无需再传。
2. **无可用 Key**——读取 `tempkey-guide.md`，引导用户申请临时体验 Key。
3. **Key 报错**——调用 `client.switch_key()` 轮询候选池切换到下一个可用 Key，并告知用户切换情况；全部不可用时，说明每个 Key 的失败原因与修正方式。

## 工作流程

### 1. 理解用户需求

当用户询问腾讯地图API相关问题时：
- 明确用户需要的功能类型（基础地图/可视化）
- 确定具体要使用的类或功能

### 2. 查询 API 文档

在 `references/jsapigl/docs/` 或 `references/visualization/docs/` 中查找相关API文档：
- 搜索关键词（如"点标记"、"热力图"）
- 阅读对应类的说明、配置参数、方法

### 3. 查找示例代码

在对应 demos 目录中查找示例：
- JS API示例：`references/jsapigl/demos/`
- 可视化示例：`references/visualization/demos/`
- 示例命名格式：`功能分类_具体示例.html`

### 4. 提供解决方案

根据文档和示例，为用户提供：
- API接口说明
- 代码示例
- 注意事项和最佳实践

## 使用示例

**用户问题**: "如何在地图上添加标记点？"

**执行流程**:
1. 读取 `references/jsapigl/docs/点标记.md` 了解 MultiMarker API
2. 查看 `references/jsapigl/demos/` 中的点标记相关示例
3. 提供完整的代码示例和说明

**用户问题**: "怎么画一个热力图？"

**执行流程**:
1. 读取 `references/visualization/docs/热力图.md` 了解 Heat API
2. 查看 `references/visualization/demos/` 中的热力图示例
3. 说明数据格式和配置选项


## 快速开始模板

基础地图初始化：

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>腾讯地图示例</title>
    <script src="https://map.qq.com/api/gljs?v=1.exp&key={TMAP_JSAPI_KEY}"></script>
    <!-- 如需可视化功能，添加: &libraries=visualization -->
</head>
<body>
    <div id="map" style="width:100%;height:500px;"></div>
    <script>
        var map = new TMap.Map("map", {
            zoom: 12,
            center: new TMap.LatLng(39.984104, 116.307503)
        });
    </script>
</body>
</html>
```

## Key 安全 / 代理服务转发

**官方文档**：https://lbs.qq.com/webApi/javascriptGL/glGuide/glKeyDelegate

- **明文 Key 仅限本地**：Key 写在 HTML `<script src="...gljs?key=XXX">` 中，任何访问者都能从源码/抓包获取，仅限本地开发/内部预览；公网发布必须改用下方代理方案。
- **代理服务转发**：将 Key 存到自有服务器，前端通过代理服务器请求腾讯 JSAPI，Key 完全不出现在 HTML 与网络请求中。Nginx 配置与前端改造步骤见 `references/key-security.md`。
- **HTML Key 安全检查**：每次生成/写入含 JSAPI GL 的 HTML 后（识别标记：URL 含 `map.qq.com/api/gljs`），按 `references/key-security.md`「HTML Key 安全检查」执行明文 Key 正则检测；命中则原样输出其中的固定安全提示文案，提醒用户盗用风险与代理方案。

## 约束：底图 & 命名空间

必须使用腾讯地图 JSAPI GL（命名空间 `TMap`）作为底图，不可混用其他地图 SDK——本 skill 的地图能力均基于腾讯位置服务，底图需与其数据、坐标系（GCJ-02）一致，否则坐标与服务不匹配。涉及中国区域的地图展示，请勿使用未取得国内测绘资质的境外地图服务，以符合国家地图合规要求。可视化图层示例见 `references/key-security.md`。

## 注意事项

### JS API GL

1. **版本**: 当前为 GL 版本，支持3D地图和WebGL渲染
2. **浏览器兼容**: 现代浏览器，IE11+（需polyfill）
3. **坐标系**: 使用 gcj02 坐标系。若用户输入的是 WGS-84/GPS 原始坐标、百度 BD09、sogou、mapbar 等，必须先转换为 GCJ-02 再使用（可用后端 WebService `/ws/coord/v1/translate`）
4. **地图创建（重要）**: 地图创建的容器一定要有固定宽高，尤其是flex布局下
5. **API使用（重要）**: 所有功能的API调用都必须使用文档中出现的接口、属性、事件，不能自己编造；
6. **API传参（重要）**: 所有的API传入参数必须严格遵守api文档中说明的格式，如果不确定就去看看对应demo，包括demo中的数据格式；
7. **附加库的使用**: 使用附加库需要在API加载URL中添加 `libraries` 参数

| 附加库 | libraries 值 | 命名空间 | 说明 |
|--------|-------------|----------|------|
| 地图工具 | `tools` | `TMap.tools` | 几何编辑器、测量工具 |
| 几何计算库 | `geometry` | `TMap.geometry` | 距离/面积计算、几何关系判断 |
| 服务类库 | `service` | `TMap.service` | 地点搜索、路线规划、行政区划等 |
| 地图视角附加库 | `view` | `TMap` (扩展方法) | 观察者视角操作地图 |
| 模型库 | `model` | `TMap.model` | GLTF/3DTiles/3DMarker 模型 |
| 天气图层 | `weather` | `TMap.weather` | 云图、温度图等气象图层 |
| 矢量数据图层 | `vector` | `TMap.vector` | GeoJSON/MVT 矢量数据图层 |
| 可视化库 | `visualization` | `TMap.visualization` | 可视化API的能力 |

**使用示例**：
```html
<!-- 加载多个附加库 -->
<script src="https://map.qq.com/api/gljs?v=1.exp&libraries=tools,geometry,service,model&key={TMAP_JSAPI_KEY}"></script>
```

### 可视化 API

1. **数据格式**: 可视化图层需要特定格式的数据输入
2. **性能**: 大数据量时注意性能优化
3. **层级**: 可视化图层可以设置显示层级
4. **事件**: 支持点击、悬停等交互事件
5. **API使用（重要）**: 所有功能的API调用都必须使用文档中出现的接口、属性、事件，不能自己编造
6. **API传参（重要）**: 所有的API传入参数必须严格遵守api文档中说明的格式，如果不确定就去看看对应demo，包括demo中的数据格式；


## 最佳实践

1. **模块化加载**: 使用模块化方式按需加载API
2. **错误处理**: 为地图加载添加常见失败场景的处理逻辑，详见下方「异常场景处理」
3. **内存管理**: 及时销毁不需要的图层和覆盖物
4. **性能优化**: 大数据集使用聚合或抽稀

## 异常场景处理

生成 HTML 地图代码时，应为以下 3 类常见失败场景加入处理逻辑。每次生成代码后自查是否都已覆盖。

### 1. 地图容器不存在

**触发条件**：`div` 元素的 `id` 拼写错误或 DOM 未就绪

**检测代码**：
```javascript
var container = document.getElementById('map');
if (!container) {
    console.error('地图容器 #map 不存在，请检查 HTML 中是否存在 <div id="map"> 元素');
    // 提示用户
    alert('地图初始化失败：未找到地图容器，请刷新页面重试');
    return;
}
```

**用户提示话术**：页面缺少地图容器元素，请检查 HTML 中是否包含 `<div id="map" style="width:100%;height:500px;"></div>`

### 2. CDN 加载超时 / 不可达

**触发条件**：`map.qq.com/api/gljs` 不可达或网络故障

**检测代码**（在 `<script>` 标签上添加 `onerror` 回调）：
```html
<script src="https://map.qq.com/api/gljs?v=1.exp&key={TMAP_JSAPI_KEY}"
    onerror="handleCDNError()"></script>
<script>
function handleCDNError() {
    console.error('腾讯地图 JSAPI 加载失败：CDN 不可达或 Key 无效，请检查网络连接及 Key 状态');
}
</script>
```

**用户提示话术**：地图资源加载失败，请检查网络连接后刷新页面重试。如持续失败可能是 CDN 临时不可达，请稍后重试。

### 3. 浏览器不支持 WebGL

**触发条件**：IE11 以下、部分老旧移动端浏览器

**检测代码**（在地图初始化前执行）：
```javascript
function checkWebGL() {
    try {
        var canvas = document.createElement('canvas');
        return !!(window.WebGLRenderingContext &&
            (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
        return false;
    }
}
if (!checkWebGL()) {
    console.error('当前浏览器不支持 WebGL，无法使用腾讯地图 JSAPI GL 版本');
}
```

**用户提示话术**：您当前的浏览器不支持 WebGL 渲染，地图无法正常显示。建议升级至最新版 Chrome、Edge 或 Firefox 浏览器后重试。
