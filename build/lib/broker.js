var Broker, EventEmitterWildcard, SockJS, backoff, bound_, trace,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  __slice = [].slice;

SockJS = require('sockjs-client');

bound_ = require('./bound');

backoff = require('./backoff');

EventEmitterWildcard = require('./eventemitterwildcard');

trace = function() {};

module.exports = Broker = (function(_super) {
  var CLOSED, Channel, NOTREADY, READY, createId, emitToChannel, _ref;

  __extends(Broker, _super);

  _ref = [0, 1, 3], NOTREADY = _ref[0], READY = _ref[1], CLOSED = _ref[2];

  Channel = require('./channel');

  createId = require('hat');

  emitToChannel = require('./util').emitToChannel;

  function Broker(ws, options) {
    var debug;
    Broker.__super__.constructor.call(this);
    this.sockURL = ws;
    this.autoReconnect = options.autoReconnect, this.authExchange = options.authExchange, this.overlapDuration = options.overlapDuration, this.servicesEndpoint = options.servicesEndpoint, this.getSessionToken = options.getSessionToken, this.brokerExchange = options.brokerExchange, this.tryResubscribing = options.tryResubscribing, debug = options.debug;
    if (debug) {
      trace = console.log;
    }
    trace("broker constructor called", ws, options);
    if (this.overlapDuration == null) {
      this.overlapDuration = 3000;
    }
    if (this.authExchange == null) {
      this.authExchange = 'auth';
    }
    if (this.brokerExchange == null) {
      this.brokerExchange = 'broker';
    }
    this.readyState = NOTREADY;
    this.channels = {};
    this.namespacedEvents = {};
    this.subscriptions = {};
    if (this.tryResubscribing == null) {
      this.tryResubscribing = true;
    }
    this.pendingSubscriptions = [];
    this.pendingUnsubscriptions = [];
    this.subscriptionThrottleMs = 2000;
    this.unsubscriptionThreshold = 40;
    this.readyState = READY;
    this.emit('ready');
    this.emit('connected');
    trace("fake init");
    return;
    if (this.autoReconnect) {
      this.initBackoff(options.backoff);
    }
    this.connect();
  }

  Broker.prototype.initBackoff = backoff;

  Broker.prototype.setP2PKeys = function(channelName, _arg, serviceType) {
    var bindingKey, channel, consumerChannel, producerChannel, routingKey;
    routingKey = _arg.routingKey, bindingKey = _arg.bindingKey;
    channel = this.channels[channelName];
    if (!channel) {
      return;
    }
    channel.close();
    consumerChannel = this.subscribe(bindingKey, {
      exchange: 'chat',
      isReadOnly: true,
      isSecret: true
    });
    consumerChannel.setAuthenticationInfo({
      serviceType: serviceType
    });
    consumerChannel.pipe(channel);
    producerChannel = this.subscribe(routingKey, {
      exchange: 'chat',
      isReadOnly: false,
      isSecret: true
    });
    producerChannel.setAuthenticationInfo({
      serviceType: serviceType
    });
    channel.off('publish');
    channel.on('publish', producerChannel.bound('publish'));
    channel.consumerChannel = consumerChannel;
    channel.producerChannel = producerChannel;
    return channel;
  };

  Broker.prototype.bound = bound_;

  Broker.prototype.onopen = function() {
    var _ref1;
    if ((_ref1 = this.ws) != null) {
      _ref1.removeEventListener(this.bound('onopen'));
    }
    if (this.autoReconnect) {
      this.clearBackoffTimeout();
    }
    this.once('broker.connected', (function(_this) {
      return function(newSocketId) {
        _this.socketId = newSocketId;
        _this.emit('ready');
        if (_this.readyState === CLOSED) {
          _this.resubscribe();
        }
        _this.readyState = READY;
        return _this.emit('ready');
      };
    })(this));
    return this.emit('connected');
  };

  Broker.prototype.onclose = function() {
    var channel, _, _ref1;
    this.setConnectionData();
    this.readyState = CLOSED;
    this.emit("disconnected", Object.keys(this.channels));
    _ref1 = this.channels;
    for (_ in _ref1) {
      if (!__hasProp.call(_ref1, _)) continue;
      channel = _ref1[_];
      channel.interrupt();
    }
    if (this.autoReconnect) {
      return process.nextTick((function(_this) {
        return function() {
          return _this.connectAttemptFail();
        };
      })(this));
    }
  };

  Broker.prototype.connectAttemptFail = function() {
    if (this.autoReconnect) {
      return this.setBackoffTimeout(this.bound("connect"), this.bound("connectFail"));
    }
  };

  Broker.prototype.connect = function() {
    trace("broker/connect");
    this.ws = new SockJS(this.sockURL, null, {
      protocols_whitelist: ['xhr-polling', 'xhr-streaming']
    });
    this.ws.addEventListener('open', this.bound('onopen'));
    this.ws.addEventListener('close', this.bound('onclose'));
    this.ws.addEventListener('message', this.bound('handleMessageEvent'));
    this.ws.addEventListener('message', (function(_this) {
      return function() {
        _this.lastTo = Date.now();
        return _this.emit('messageArrived');
      };
    })(this));
    return this;
  };

  Broker.prototype.disconnect = function(reconnect) {
    var _ref1;
    if (reconnect == null) {
      reconnect = true;
    }
    trace("broker/disconnect", reconnect);
    if (reconnect != null) {
      this.autoReconnect = !!reconnect;
    }
    if ((_ref1 = this.ws) != null) {
      _ref1.close();
    }
    return this;
  };

  Broker.prototype.connectFail = function() {
    trace("broker/connectFail", reconnect);
    return this.emit('connectFailed');
  };

  Broker.prototype.createRoutingKeyPrefix = function(name, options) {
    var isReadOnly, suffix;
    if (options == null) {
      options = {};
    }
    isReadOnly = options.isReadOnly, suffix = options.suffix;
    name += suffix || '';
    if (isReadOnly) {
      return name;
    } else {
      return "client." + name;
    }
  };

  Broker.prototype.wrapPrivateChannel = function(channel) {
    trace("broker/wrapPrivateChannel", channel);
    channel.on('cycle', (function(_this) {
      return function() {
        return _this.authenticate(channel);
      };
    })(this));
    return channel.on('setSecretNames', (function(_this) {
      return function(secretName) {
        var consumerChannel, isReadOnly;
        isReadOnly = channel.isReadOnly;
        channel.setSecretName(secretName);
        channel.isForwarder = true;
        consumerChannel = _this.subscribe(secretName.publishingName, {
          isReadOnly: isReadOnly,
          isSecret: true,
          exchange: channel.exchange
        });
        consumerChannel.setAuthenticationInfo({
          serviceType: 'secret',
          wrapperRoutingKeyPrefix: channel.routingKeyPrefix
        });
        channel.consumerChannel = consumerChannel;
        consumerChannel.on('cycleChannel', function() {
          channel.oldConsumerChannel = channel.consumerChannel;
          return channel.cycle();
        });
        if (!isReadOnly) {
          channel.on('publish', function() {
            var rest;
            rest = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
            return consumerChannel.publish.apply(consumerChannel, rest);
          });
        }
        _this.swapPrivateSourceChannel(channel);
        return channel.emit('ready');
      };
    })(this));
  };

  Broker.prototype.swapPrivateSourceChannel = function(channel) {
    var consumerChannel, oldConsumerChannel;
    consumerChannel = channel.consumerChannel, oldConsumerChannel = channel.oldConsumerChannel;
    if (oldConsumerChannel != null) {
      return setTimeout((function(_this) {
        return function() {
          oldConsumerChannel.close().off();
          delete channel.oldConsumerChannel;
          return consumerChannel.pipe(channel);
        };
      })(this), this.overlapDuration);
    } else {
      return consumerChannel.pipe(channel);
    }
  };

  Broker.prototype.registerNamespacedEvent = function(name) {
    var register;
    register = this.namespacedEvents;
    if (register[name] == null) {
      register[name] = 0;
    }
    register[name] += 1;
    return register[name] === 1;
  };

  Broker.prototype.createChannel = function(name, options) {
    var channel, exchange, handler, isExclusive, isP2P, isPrivate, isReadOnly, isSecret, mustAuthenticate, routingKeyPrefix, suffix;
    trace("broker/createChannel", name, options);
    if (this.channels[name] != null) {
      return this.channels[name];
    }
    isReadOnly = options.isReadOnly, isSecret = options.isSecret, isExclusive = options.isExclusive, isPrivate = options.isPrivate, isP2P = options.isP2P, suffix = options.suffix, exchange = options.exchange, mustAuthenticate = options.mustAuthenticate;
    if (suffix == null) {
      suffix = isExclusive ? "." + (createId(32)) : '';
    }
    routingKeyPrefix = this.createRoutingKeyPrefix(name, {
      suffix: suffix,
      isReadOnly: isReadOnly
    });
    channel = new Channel(name, routingKeyPrefix, {
      isReadOnly: isReadOnly,
      isSecret: isSecret,
      isP2P: isP2P,
      isExclusive: isExclusive != null ? isExclusive : isPrivate,
      exchange: exchange,
      mustAuthenticate: mustAuthenticate
    });
    this.on('broker.subscribed', handler = (function(_this) {
      return function(routingKeyPrefixes) {
        var prefix, _i, _len, _ref1;
        trace("broker/broker.subscribed", routingKeyPrefixes);
        _ref1 = routingKeyPrefixes.split(' ');
        for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
          prefix = _ref1[_i];
          if (!(prefix === routingKeyPrefix)) {
            continue;
          }
          _this.authenticate(channel);
          _this.off('broker.subscribed', handler);
          channel.emit('broker.subscribed', channel.routingKeyPrefix);
          return;
        }
      };
    })(this));
    this.on(routingKeyPrefix, function() {
      var rest;
      rest = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      if (!channel.isForwarder) {
        return channel.emit.apply(channel, ['message'].concat(__slice.call(rest)));
      }
    });
    channel.on('newListener', (function(_this) {
      return function(event, listener) {
        var namespacedEvent, needsToBeRegistered;
        if (channel.isExclusive || channel.isP2P) {
          channel.trackListener(event, listener);
        }
        if (event !== 'broker.subscribed') {
          namespacedEvent = "" + routingKeyPrefix + "." + event;
          needsToBeRegistered = _this.registerNamespacedEvent(namespacedEvent);
          if (needsToBeRegistered) {
            return _this.on(namespacedEvent, function() {
              var rest;
              rest = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
              return emitToChannel.apply(null, [_this, channel, event].concat(__slice.call(rest)));
            });
          }
        }
      };
    })(this));
    if (!isSecret) {
      channel.on('auth.authOk', function() {
        return channel.isAuthenticated = true;
      });
    }
    channel.once('error', channel.bound('close'));
    channel.once('close', (function(_this) {
      return function() {
        return _this.unsubscribe(channel.name);
      };
    })(this));
    if (isExclusive || isPrivate) {
      this.wrapPrivateChannel(channel);
    }
    if (!(isPrivate || isReadOnly)) {
      channel.on('publish', (function(_this) {
        return function(options, payload) {
          var _ref1, _ref2, _ref3;
          if (payload == null) {
            _ref1 = [options, payload], payload = _ref1[0], options = _ref1[1];
          }
          exchange = (_ref2 = (_ref3 = options != null ? options.exchange : void 0) != null ? _ref3 : channel.exchange) != null ? _ref2 : channel.name;
          return _this.publish({
            exchange: exchange,
            routingKey: channel.name
          }, payload);
        };
      })(this));
    }
    this.channels[name] = channel;
    return channel;
  };

  Broker.prototype.authenticate = function(channel) {
    var authInfo, key, val, _ref1;
    trace("broker/authenticate", channel);
    if (channel.mustAuthenticate) {
      authInfo = {};
      _ref1 = channel.getAuthenticationInfo();
      for (key in _ref1) {
        if (!__hasProp.call(_ref1, key)) continue;
        val = _ref1[key];
        authInfo[key] = val;
      }
      authInfo.routingKey = channel.routingKeyPrefix;
      authInfo.brokerExchange = this.brokerExchange;
      return this.publish(this.authExchange, authInfo);
    } else {
      return process.nextTick(function() {
        return channel.emit('auth.authOk');
      });
    }
  };

  Broker.prototype.handleMessageEvent = function(event) {
    var message;
    trace("broker/handleMessageEvent", event);
    message = event.data;
    this.emit('rawMessage', message);
    if (message.routingKey) {
      this.emit(message.routingKey, message.payload);
    }
  };

  Broker.prototype.ready = function(listener) {
    trace("broker/ready");
    if (this.readyState === READY) {
      return process.nextTick(listener);
    } else {
      return this.once('ready', listener);
    }
  };

  Broker.prototype.send = function(data) {
    trace("broker/send", data);
    this.emit('send', data);
    this.ready((function(_this) {
      return function() {
        var e, _ref1;
        try {
          return (_ref1 = _this.ws) != null ? _ref1._transport.doSend(JSON.stringify(data)) : void 0;
        } catch (_error) {
          e = _error;
          return _this.disconnect();
        }
      };
    })(this));
    return this;
  };

  Broker.prototype.publish = function(options, payload) {
    var exchange, routingKey;
    trace("broker/publish", options, payload);
    this.emit('messagePublished');
    if ('string' === typeof options) {
      routingKey = exchange = options;
    } else {
      routingKey = options.routingKey, exchange = options.exchange;
    }
    routingKey = this.createRoutingKeyPrefix(routingKey);
    if ('string' !== typeof payload) {
      payload = JSON.stringify(payload);
    }
    this.send({
      action: 'publish',
      exchange: exchange,
      routingKey: routingKey,
      payload: payload
    });
    return this;
  };

  Broker.prototype.resubscribeBySocketId = function(socketId, failCallback) {
    trace("broker/resubscribeBySocketId", socketId);
    if (!socketId) {
      return typeof failCallback === "function" ? failCallback() : void 0;
    }
    this.send({
      action: 'resubscribe',
      socketId: socketId
    });
    return this.once('broker.resubscribed', (function(_this) {
      return function(found) {
        var channel, _, _ref1;
        if (found) {
          _ref1 = _this.channels;
          for (_ in _ref1) {
            if (!__hasProp.call(_ref1, _)) continue;
            channel = _ref1[_];
            channel.resume();
            channel.emit('broker.subscribed');
          }
          return _this.setConnectionData();
        } else {
          return typeof failCallback === "function" ? failCallback() : void 0;
        }
      };
    })(this));
  };

  Broker.prototype.resubscribeByOldSocketId = function(failCallback) {
    var clientId, oldSocket, socketId;
    if (failCallback == null) {
      failCallback = function() {};
    }
    trace("broker/resubscribeByOldSocketId", this.tryResubscribing);
    if (!this.tryResubscribing) {
      return failCallback();
    }
    oldSocket = this.getConnectionData();
    if (!oldSocket) {
      return failCallback();
    }
    clientId = oldSocket.clientId, socketId = oldSocket.socketId;
    if (this.getSessionToken() === clientId) {
      return this.resubscribeBySocketId(socketId, function() {
        return failCallback();
      });
    } else {
      this.setConnectionData();
      return failCallback();
    }
  };

  Broker.prototype.resubscribeBySubscriptions = function() {
    var rk, routingKeyPrefix, _;
    routingKeyPrefix = ((function() {
      var _ref1, _results;
      _ref1 = this.subscriptions;
      _results = [];
      for (_ in _ref1) {
        if (!__hasProp.call(_ref1, _)) continue;
        rk = _ref1[_].routingKeyPrefix;
        _results.push(rk);
      }
      return _results;
    }).call(this)).join(' ');
    this.sendSubscriptions(routingKeyPrefix);
    return this.once('broker.subscribed', (function(_this) {
      return function(routingKeyPrefixes) {
        var channel, prefix, _i, _len, _ref1, _results;
        _ref1 = routingKeyPrefixes.split(' ');
        _results = [];
        for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
          prefix = _ref1[_i];
          _results.push((function() {
            var _ref2, _results1;
            _ref2 = this.channels;
            _results1 = [];
            for (_ in _ref2) {
              if (!__hasProp.call(_ref2, _)) continue;
              channel = _ref2[_];
              if ((channel != null ? channel.routingKeyPrefix : void 0) === prefix) {
                channel.resume();
                _results1.push(channel.emit('broker.subscribed'));
              } else {
                _results1.push(void 0);
              }
            }
            return _results1;
          }).call(_this));
        }
        return _results;
      };
    })(this));
  };

  Broker.prototype.resubscribe = function(callback) {
    trace("broker/resubscribe");
    return this.resubscribeByOldSocketId((function(_this) {
      return function() {
        return _this.resubscribeBySocketId(_this.socketId, function() {
          _this.resubscribeBySubscriptions();
          return _this.setConnectionData();
        });
      };
    })(this));
  };

  Broker.prototype.subscribe = function(name, options, callback) {
    var channel, exchange, handler, isExclusive, isP2P, isPrivate, isReadOnly, isSecret, mustAuthenticate, routingKeyPrefix, suffix, _ref1;
    if (options == null) {
      options = {};
    }
    trace("broker/subscribe");
    channel = this.channels[name];
    if (channel == null) {
      isSecret = !!options.isSecret;
      isExclusive = !!options.isExclusive;
      isReadOnly = options.isReadOnly != null ? !!options.isReadOnly : isExclusive;
      isPrivate = !!options.isPrivate;
      isP2P = !!options.isP2P;
      mustAuthenticate = (_ref1 = options.mustAuthenticate) != null ? _ref1 : true;
      suffix = options.suffix, exchange = options.exchange;
      routingKeyPrefix = this.createRoutingKeyPrefix(name, {
        isReadOnly: isReadOnly
      });
      this.subscriptions[name] = {
        name: name,
        routingKeyPrefix: routingKeyPrefix,
        arguments: arguments
      };
      channel = this.channels[name] = this.createChannel(name, {
        isReadOnly: isReadOnly,
        isSecret: isSecret,
        isExclusive: isExclusive,
        isPrivate: isPrivate,
        isP2P: isP2P,
        suffix: suffix,
        exchange: exchange,
        mustAuthenticate: mustAuthenticate
      });
      if (options.connectDirectly) {
        this.sendSubscriptions(channel.routingKeyPrefix);
      } else {
        this.enqueueSubscription(channel.routingKeyPrefix);
      }
    }
    if (callback != null) {
      this.on('broker.subscribed', handler = (function(_this) {
        return function(routingKeyPrefixes) {
          var prefix, _i, _len, _ref2;
          trace("broker/broker.subscribed", routingKeyPrefixes);
          _ref2 = routingKeyPrefixes.split(' ');
          for (_i = 0, _len = _ref2.length; _i < _len; _i++) {
            prefix = _ref2[_i];
            if (!(prefix === routingKeyPrefix)) {
              continue;
            }
            _this.off('broker.subscribed', handler);
            callback(prefix);
            return;
          }
        };
      })(this));
    }
    return channel;
  };

  Broker.prototype.enqueueSubscription = function(routingKeyPrefix) {
    var i, len;
    trace("broker/enqueueSubscription", routingKeyPrefix);
    i = this.pendingUnsubscriptions.indexOf(routingKeyPrefix);
    if (i === -1) {
      len = this.pendingSubscriptions.push(routingKeyPrefix);
      if (len === 1) {
        this.triggerSubscriptions();
      }
    } else {
      this.pendingUnsubscriptions.splice(i, 1);
    }
    return this;
  };

  Broker.prototype.triggerSubscriptions = function() {
    trace("broker/triggerSubscriptions");
    setTimeout((function(_this) {
      return function() {
        var pendingSubscriptions;
        pendingSubscriptions = _this.pendingSubscriptions;
        _this.pendingSubscriptions = [];
        if (pendingSubscriptions.length > 0) {
          return _this.sendSubscriptions(pendingSubscriptions.join(' '));
        }
      };
    })(this), this.subscriptionThrottleMs);
    return this;
  };

  Broker.prototype.sendSubscriptions = function(subscriptions) {
    trace("broker/sendSubscriptions", subscriptions);
    return this.send({
      action: 'subscribe',
      routingKeyPrefix: subscriptions
    });
  };

  Broker.prototype.enqueueUnsubscription = function(routingKeyPrefix) {
    var i, len;
    trace("broker/enqueueUnsubscription", routingKeyPrefix);
    i = this.pendingSubscriptions.indexOf(routingKeyPrefix);
    if (i === -1) {
      len = this.pendingUnsubscriptions.push(routingKeyPrefix);
      if (len >= this.unsubscriptionThreshold) {
        this.sendUnsubscriptions();
      }
    } else {
      this.pendingSubscriptions.splice(i, 1);
    }
    return this;
  };

  Broker.prototype.sendUnsubscriptions = function() {
    var key, pendingUnsubscriptions, _i, _len;
    trace("broker/sendUnsubscriptions", sendUnsubscriptions);
    pendingUnsubscriptions = this.pendingUnsubscriptions;
    this.send({
      action: 'unsubscribe',
      routingKeyPrefix: pendingUnsubscriptions.join(' ')
    });
    for (_i = 0, _len = pendingSubscriptions.length; _i < _len; _i++) {
      key = pendingSubscriptions[_i];
      this.removeSubscriptionKey(key);
    }
    return this;
  };

  Broker.prototype.unsubscribe = function(name) {
    var prefix;
    trace("broker/  unsubscribe", name);
    prefix = this.createRoutingKeyPrefix(name);
    this.send({
      action: 'unsubscribe',
      routingKeyPrefix: prefix
    });
    this.removeSubscriptionKey(name);
    return this;
  };

  Broker.prototype.removeSubscriptionKey = function(name) {
    delete this.channels[name];
    delete this.subscriptions[name];
    return this;
  };

  Broker.prototype.ping = function(callback) {
    trace("broker/ping", name);
    this.send({
      action: "ping"
    });
    if (callback != null) {
      return this.once("broker.pong", callback);
    }
  };

  Broker.prototype.getConnectionData = function() {
    var data;
    data = localStorage.getItem("connectiondata");
    if (data) {
      return JSON.parse(data);
    }
  };

  Broker.prototype.setConnectionData = function() {
    var data;
    trace("broker/setConnectionData");
    data = JSON.stringify({
      clientId: this.getSessionToken(),
      socketId: this.socketId
    });
    return localStorage.setItem("connectiondata", data);
  };

  return Broker;

})(EventEmitterWildcard);
