// https://github.com/websockets/ws/issues/596
var WSStream = module.exports = (function(){
    var util = require('util');
    var stream = require('stream');
    var Duplex = stream.Duplex || require('readable-stream').Duplex;
    var WSStream = function(ws, wsOptions, streamingOptions) { // Only the websocket (ws) is mandatory
        // Proper duplex stream with automatic flow control (backpressure) management
        if(!(this instanceof WSStream)) return new WSStream(ws, wsOptions, streamingOptions);
        if(!(wsOptions instanceof Object)) wsOptions = {binary: false};
        Duplex.call(this, streamingOptions);
        this.waitingForData = true;
        this.writeModBufferEmpty = true;
        this.webSocket = ws;
        this.webSocketOptions = wsOptions;
        this.on('finish', finishEventHandler(this));
        ws._socket.write = writeMod(ws._socket.write, this);
        ws._socket.on('drain', drainEventHandler(this));
        ws._socket.on('error', errorRouter(this));
        ws.on('close', closeEventHandler(this));
        ws.on('message', messageHandler(this));
        },
    finishEventHandler = function(self) {
        return function() {
            if(self.webSocket !== null) {
                self.webSocket.close();
                self.webSocket = null;
                };
            self.emit('close');
            };
        },
    writeMod = function(nativeWriteFunction, self) {
        return function() {
            return self.writeModBufferEmpty = nativeWriteFunction.apply(this, arguments);
            };
        },
    drainEventHandler = function(self) {
        return function() {
            self.writeModBufferEmpty = true;
            self.emit('drain');
            };
        },
    closeEventHandler = function(self) {
        return function() {
            self.push(null);
            }
        },
    errorRouter = function(self) {
        return function() {
            self.emit.apply(self, ['error'].concat(arguments));
            };
        },
    messageHandler = function(self) {
        return function(data) {
            if(!self.push(data) && self.waitingForData) {
                self.webSocket._socket.pause();
                self.waitingForData = false;
                }
            };
        };
    util.inherits(WSStream, Duplex);
    WSStream.prototype._read = function(size) {
        if(!this.waitingForData) {
            this.waitingForData = true;
            this.webSocket._socket.resume();
            }
        };
    WSStream.prototype._write = function(chunk, encoding, callback) {
        this.webSocket.send(chunk, this.webSocketOptions, callback);
        return this.writeModBufferEmpty;
        };
    return WSStream;
    }());
module.exports.create = function (ws, wsOpts, streamOpts) {
  return new WSStream(ws, wsOpts, streamOpts);
};
