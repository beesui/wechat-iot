wechat-iot
======

微信公共平台独立设备管理Node库  **FORK FROM node-webot/wechat(https://github.com/node-webot/wechat)**


## 功能列表


## Installation

```sh
$ npm install wechat-iot
```

## Use with Connect/Express

```js
var wechat = require('wechat-iot');
var config = {
  token: 'token',
  appid: 'appid',
  encodingAESKey: 'encodinAESKey'
};

app.use(express.query());
app.use('/wechat', wechat(config, function (req, res, next) {
  // 微信输入信息都在req.weixin上
  var message = req.weixin;
}));
```
备注：token在微信平台的开发者中心申请

### 回复设备消息
模块可以对类型为device_text或device_event的消息作出特定格式的响应.
```js
var wechat = require('wechat');
var config = {
  token: 'token',
  appid: 'appid',
  encodingAESKey: 'encodinAESKey'
};

app.use(express.query());
app.use('/wechat', wechat(config, function (req, res, next) {
  // 微信输入信息都在req.weixin上
  var message = req.weixin;
  if (message.MsgType === 'device_event') {
    if (message.Event === 'subscribe_status' ||
      message.Event === 'unsubscribe_status') {
    //WIFI设备状态订阅,回复设备状态(1或0)
      res.reply(1);
    } else {
      res.reply('这条回复会推到设备里去.')
    }
  }
}));
```

目前微信公共平台能接收到1种内容：事件。

```js
app.use('/wechat', wechat('some token', wechat.device_event(function (message, req, res, next) {
  // message为设备事件内容
  // { ToUserName: 'gh_d3e07d51b513',
  // FromUserName: 'oPKu7jgOibOA-De4u8J2RuNKpZRw',
  // CreateTime: '1359125022',
  // MsgType: 'device_event',
  // Event: 'bind'
  // DeviceType: 'gh_d3e07d51b513'
  // DeviceID: 'dev1234abcd',
  // OpType : 0, //Event为subscribe_status/unsubscribe_status时存在
  // Content: 'd2hvc3lvdXJkYWRkeQ==', //Event不为subscribe_status/unsubscribe_status时存在
  // SessionID: '9394',
  // MsgId: '5837397520665436492',
  // OpenID: 'oPKu7jgOibOA-De4u8J2RuNKpZRw' }
})));
```

### 更简化的API设计
示例如下：

```js
app.use('/wechat', wechat('some token').device_event(function (message, req, res, next) {
  // TODO
}).middlewarify());
```
该接口从0.3.x提供。

## License
The MIT license.
