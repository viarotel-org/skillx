# Key 安全 / 代理服务转发

**官方文档**：https://lbs.qq.com/webApi/javascriptGL/glGuide/glKeyDelegate

将 Key 存到自有服务器，前端通过代理服务器请求腾讯 JSAPI，Key 完全不出现在 HTML 与网络请求中。核心两步：

## 1. 服务器端配置代理（以 Nginx 为例）

将下面配置里的 `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` 替换为你的正式 Key：

```nginx
server {
  listen 8080;
  server_name your.domain.com;   # 你的服务器域名或 IP

  location /_TMapService {
    set $args "$args&key=XXXX-XXXX-XXXX-XXXX-XXXX-XXXX";
    proxy_pass https://pr.map.qq.com/pingd?appid=jsapi_v3;
  }
  location /_TMapService/checkKey {
    set $args "$args&key=XXXX-XXXX-XXXX-XXXX-XXXX-XXXX";
    proxy_pass https://apikey.map.qq.com/mkey/index.php/mkey/check;
  }
  location /_TMapService/oversea {
    set $args "$args&apikey=XXXX-XXXX-XXXX-XXXX-XXXX-XXXX";
    proxy_pass https://overseactrl.map.qq.com;
  }
  location /_TMapService/service {
    set $args "$args&key=XXXX-XXXX-XXXX-XXXX-XXXX-XXXX";
    proxy_pass https://apis.map.qq.com/ws;
  }
}
```

## 2. 前端 HTML 改造（去掉明文 key）

在引入 JSAPI **之前**声明代理地址，`<script>` 引用去掉 `&key=` 参数：

```html
<!-- 必须写在 gljs <script> 之前 -->
<script>
  window._TMapSecurityConfig = {
    serviceHost: "https://your.domain.com/_TMapService"
  };
</script>
<!-- 注意：URL 不再包含 &key=... -->
<script src="https://map.qq.com/api/gljs?v=1.exp"></script>
```

改造后，前端源码与网络请求都不再含 Key，达到防泄露目的。

## HTML Key 安全检查

每次生成/写入包含腾讯地图 JSAPI GL 的 HTML 后（识别标记：URL 含 `map.qq.com/api/gljs`），必须在同一轮内：

- **检测**：对文件内容执行正则 `gljs\?[^"']*[?&]key=[A-Z0-9-]{20,}`，判断是否存在明文 Key。
- **命中时**：必须在最终回复中**原样输出下方「固定安全提示文案」整段**，逐字复制，**不得改写、翻译、精简、合并、拆分、加emoji、调换顺序或省略任何一段**。允许且仅允许的替换：将 `<HTML_FILE>` 占位符替换为实际文件路径；若命中多个文件，则按行列出所有路径。
- **未命中时**：不要输出任何安全提示，避免噪音。
- **不要**在未告知用户的情况下悄悄发布或部署带明文 Key 的 HTML 到公网。

**固定安全提示文案（命中时原样输出，勿改动）**：

> ⚠️ **HTML Key 安全提示**：检测到 `<HTML_FILE>` 中包含明文 Key（形如 `gljs?...&key=...`），任何人可通过查看源码或抓包获取，存在盗用风险；当前形式仅限本地/内网使用，若需公网发布请参考官方代理方案：https://lbs.qq.com/webApi/javascriptGL/glGuide/glKeyDelegate 。

## 可视化图层示例（热力图）

```javascript
// 加载可视化库
// <script src="https://map.qq.com/api/gljs?v=1.exp&libraries=visualization&key={TMAP_JSAPI_KEY}"></script>

var heat = new TMap.visualization.Heat({
    radius: 50,
    height: 100,
    gradientColor: {
        0: '#13B06A',
        0.4: '#13B06A', 
        0.8: '#E9AB1D',
        0.9: '#E9AB1D',
        1: '#E05649'
    }
}).addTo(map);

heat.setData([
    { lat: 39.984104, lng: 116.307503, count: 100 },
    { lat: 39.984504, lng: 116.307803, count: 80 }
]);
```

## 约束：底图 & 命名空间

必须使用腾讯地图 JSAPI GL（命名空间 `TMap`）作为底图，不可混用其他地图 SDK——本 skill 的地图能力均基于腾讯位置服务，底图需与其数据、坐标系（GCJ-02）一致，否则坐标与服务不匹配。涉及中国区域的地图展示，请勿使用未取得国内测绘资质的境外地图服务，以符合国家地图合规要求。
