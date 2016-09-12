var crypto = require('crypto');
var WXBizMsgCrypt = require('wechat-crypto');

/**
 * 检查签名
 */
var checkSignature = function (query, token) {
  var signature = query.signature;
  var timestamp = query.timestamp;
  var nonce = query.nonce;

  var shasum = crypto.createHash('sha1');
  var arr = [token, timestamp, nonce].sort();
  shasum.update(arr.join(''));

  return shasum.digest('hex') === signature;
};

var load = function (stream, callback) {
  // support content-type 'text/xml' using 'express-xml-bodyparser', which set raw xml string
  // to 'req.rawBody'(while latest body-parser no longer set req.rawBody), see
  // https://github.com/macedigital/express-xml-bodyparser/blob/master/lib/types/xml.js#L79
  if (stream.rawBody) {
    callback(null, stream.rawBody);
    return;
  }

  var buffers = [];
  stream.on('data', function (trunk) {
    buffers.push(trunk);
  });
  stream.on('end', function () {
    callback(null, Buffer.concat(buffers));
  });
  stream.once('error', callback);
};

var respond = function (handler) {
  return function (req, res, next) {
    var message = req.weixin;
    var callback = handler.getHandler(message.MsgType);

    var done = function () {
      // 兼容旧API
      if (handler.handle) {
        callback(req, res, next);
      } else {
        callback(message, req, res, next);
      }
    };

    done();
  };
};

/**
 * 微信自动回复平台的内部的Handler对象
 * @param {String|Object} config 配置
 * @param {Function} handle handle对象
 */
var Handler = function (token, handle) {
  if (token) {
    this.setToken(token);
  }
  this.handlers = {};
  this.handle = handle;
};

Handler.prototype.setToken = function (token) {
  if (typeof token === 'string') {
    this.token = token;
  } else {
    this.token = token.token;
    this.appid = token.appid;
    this.encodingAESKey = token.encodingAESKey;
  }
};

/**
 * 设置handler对象
 * 按消息设置handler对象的快捷方式
 *
 * - `text(fn)`
 * - `image(fn)`
 * - `voice(fn)`
 * - `video(fn)`
 * - `location(fn)`
 * - `link(fn)`
 * - `event(fn)`
 * @param {String} type handler处理的消息类型
 * @param {Function} handle handle对象
 */
Handler.prototype.setHandler = function (type, fn) {
  this.handlers[type] = fn;
  return this;
};

['device_text', 'device_event'].forEach(function (method) {
  Handler.prototype[method] = function (fn) {
    return this.setHandler(method, fn);
  };
});

/**
 * 根据消息类型取出handler对象
 * @param {String} type 消息类型
 */
Handler.prototype.getHandler = function (type) {
  return this.handle || this.handlers[type] || function (info, req, res, next) {
    next();
  };
};

var serveEncrypt = function (that, req, res, next, _respond) {
  var method = req.method;
  // 加密模式
  var signature = req.query.msg_signature;
  var timestamp = req.query.timestamp;
  var nonce = req.query.nonce;

  // 判断是否已有前置cryptor
  var cryptor = req.cryptor || that.cryptor;

  if (method === 'GET') {
    var echostr = req.query.echostr;
    if (signature !== cryptor.getSignature(timestamp, nonce, echostr)) {
      res.writeHead(401);
      res.end('Invalid signature');
      return;
    }
    var result = cryptor.decrypt(echostr);
    // TODO 检查appId的正确性
    res.writeHead(200);
    res.end(result.message);
  } else if (method === 'POST') {
    load(req, function (err, buf) {
      if (err) {
        return next(err);
      }
      var messageObj = JSON.parse(buf.toString('utf-8'));
      if (messageObj.encrypt) {
        var encryptMessage = messageObj.encrypt;
        if (signature !== cryptor.getSignature(timestamp, nonce, encryptMessage)) {
          res.writeHead(401);
          res.end('Invalid signature');
          return;
        }
        var decrypted = cryptor.decrypt(encryptMessage);
        var jsonMessage = JSON.parse(decrypted.message);
        var messageXml = {
          ToUserName: '',
          FromUserName: jsonMessage.open_id,
          CreateTime: jsonMessage.create_time,
          MsgType: jsonMessage.msg_type,
          DeviceType: jsonMessage.device_type,
          DeviceID: jsonMessage.device_id,
          Content: jsonMessage.content,
          MsgId: jsonMessage.msg_id,
          OpenID: jsonMessage.open_id,
        };
        req.weixin_obj = jsonMessage;
        req.weixin = messageXml;
        _respond(req, res, next);
      }
    });
  } else {
    res.writeHead(501);
    res.end('Not Implemented');
  }
};

/**
 * 根据Handler对象生成响应方法，并最终生成中间件函数
 */
Handler.prototype.middlewarify = function () {
  var that = this;
  if (this.encodingAESKey) {
    that.cryptor = new WXBizMsgCrypt(this.token, this.encodingAESKey, this.appid);
  }
  var token = this.token;
  var _respond = respond(this);
  return function (req, res, next) {
    // 如果已经解析过了，调用相关handle处理
    if (req.weixin) {
      _respond(req, res, next);
      return;
    }
    if (req.query.encrypt_type && req.query.msg_signature) {
      serveEncrypt(that, req, res, next, _respond);
    } else {
      var method = req.method;
      // 动态token，在前置中间件中设置该值req.wechat_token，优先选用
      if (!checkSignature(req.query, req.wechat_token || token)) {
        res.writeHead(401);
        res.end('Invalid signature');
        return;
      }
      if (method === 'GET') {
        res.writeHead(200);
        res.end(req.query.echostr);
      } else if (method === 'POST') {
        getMessage(req, function (err, result) {
          if (err) {
            err.name = 'BadMessage' + err.name;
            return next(err);
          }
          req.weixin = formatMessage(result.xml);
          _respond(req, res, next);
        });
      } else {
        res.writeHead(501);
        res.end('Not Implemented');
      }
    }
  };
};

/**
 * 根据口令
 *
 * Examples:
 * 使用wechat作为自动回复中间件的三种方式
 * ```
 * wechat(token, function (req, res, next) {});
 *
 * wechat(token, wechat.text(function (message, req, res, next) {
 *   // TODO
 * }).location(function (message, req, res, next) {
 *   // TODO
 * }));
 *
 * wechat(token)
 *   .text(function (message, req, res, next) {
 *     // TODO
 *   }).location(function (message, req, res, next) {
 *    // TODO
 *   }).middlewarify();
 * ```
 * 加密模式下token为config
 *
 * ```
 * var config = {
 *  token: 'token',
 *  appid: 'appid',
 *  encodingAESKey: 'encodinAESKey'
 * };
 * wechat(config, function (req, res, next) {});
 * ```
 *
 * 静态方法
 *
 * - `text`，处理文字推送的回调函数，接受参数为(text, req, res, next)。
 * - `image`，处理图片推送的回调函数，接受参数为(image, req, res, next)。
 * - `voice`，处理声音推送的回调函数，接受参数为(voice, req, res, next)。
 * - `video`，处理视频推送的回调函数，接受参数为(video, req, res, next)。
 * - `location`，处理位置推送的回调函数，接受参数为(location, req, res, next)。
 * - `link`，处理链接推送的回调函数，接受参数为(link, req, res, next)。
 * - `event`，处理事件推送的回调函数，接受参数为(event, req, res, next)。
 * - `shortvideo`，处理短视频推送的回调函数，接受参数为(event, req, res, next)。
 * @param {String} token 在微信平台填写的口令
 * @param {Function} handle 生成的回调函数，参见示例
 */
var middleware = function (token, handle) {
  if (arguments.length === 1) {
    return new Handler(token);
  }

  if (handle instanceof Handler) {
    handle.setToken(token);
    return handle.middlewarify();
  } else {
    return new Handler(token, handle).middlewarify();
  }
};

['device_text', 'device_event'].forEach(function (method) {
  middleware[method] = function (fn) {
    return (new Handler())[method](fn);
  };
});

middleware.checkSignature = checkSignature;

module.exports = middleware;
