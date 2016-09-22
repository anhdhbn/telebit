'use strict';

var machine = {};
machine._version = 1;
machine.state = 0;
machine.states = { 0: 'version', 1: 'headerLength', 2: 'header', 3: 'data'/*, 4: 'error'*/ };
machine.states_length = Object.keys(machine.states).length;
machine.chunkIndex = 0;
machine.fns = {};

function debug(chunk, i, len) {
  i = i || 0;
  len = len || chunk.length - i;
  console.log(chunk.slice(i, len)[0]);
  console.log(chunk);
  console.log('state:', machine.states[machine.state]);
  console.log('statei:', machine.state);
  console.log('index:', machine.chunkIndex);
}

machine.fns.version = function (chunk) {
  if ((255 - machine._version) !== chunk[machine.chunkIndex]) {
    console.error("not v" + machine._version + " (or data is corrupt)");
    // no idea how to fix this yet
  }
  machine.chunkIndex += 1;
};


machine.headerLen = 0;
machine.fns.headerLength = function (chunk) {
  machine.headerLen = chunk[machine.chunkIndex];
  machine.chunkIndex += 1;
};


machine.buf = null;
machine.bufIndex = 0;
//var buf = Buffer.alloc(4096);
machine.fns.header = function (chunk) {
  var curSize = machine.bufIndex + (chunk.length - machine.chunkIndex);
  var partLen = 0;
  var str = '';

  if (curSize < machine.headerLen) {
    // I still don't have the whole header,
    // so just create a large enough buffer,
    // write these bits, and wait for the next chunk.
    if (!machine.buf) {
      machine.buf = Buffer.alloc(machine.headerLen);
    }
    partLen = machine.headerLen - machine.bufIndex;
    machine.buf.write(chunk.slice(machine.chunkIndex, machine.chunkIndex + partLen), machine.bufIndex);
    machine.chunkIndex += partLen; // this MUST be chunk.length
    machine.bufIndex += partLen;
  }
  else {
    // it's now ready to discover the whole header
    if (machine.buf) {
      str += machine.buf.slice(0, machine.bufIndex).toString();
    }
    partLen = machine.headerLen - str.length;
    str += chunk.slice(machine.chunkIndex, machine.chunkIndex + partLen).toString();
    machine.chunkIndex += partLen;
    // TODO maybe just use maxlen of buffer
    machine.buf = null; // back to null
    machine.bufIndex = 0; // back to 0

    machine._headers = str.split(/,/g);
    console.log(partLen);
    console.log('');
    console.log(chunk.toString());
    console.log('');
    console.log(str);
    console.log(machine._headers);
    machine.family = machine._headers[0];
    machine.address = machine._headers[1];
    machine.port = machine._headers[2];
    machine.bodyLen = machine._headers[3];
  }
};

machine.fns.data = function (chunk) {
  var curSize = machine.bufIndex + (chunk.length - machine.chunkIndex);
  var partLen = 0;
  var buf;

  if (curSize < machine.bodyLen) {
    // I still don't have the whole header,
    // so just create a large enough buffer,
    // write these bits, and wait for the next chunk.
    if (!machine.buf) {
      machine.buf = Buffer.alloc(machine.bodyLen);
    }
    partLen = machine.bodyLen - machine.bufIndex;
    machine.buf.write(chunk.slice(machine.chunkIndex, machine.chunkIndex + partLen), machine.bufIndex);
    //machine.chunkIndex += partLen; // this MUST be chunk.length
    machine.bufIndex += partLen;
    return;
  }

  // it's now ready to discover the whole header
  if (!machine.buf) {
    buf = chunk;
    machine.chunkIndex = chunk.length;
  }
  else {
    partLen = machine.bodyLen - machine.bufIndex;
    machine.buf.write(chunk.slice(machine.chunkIndex, machine.chunkIndex + partLen), machine.bufIndex);
    machine.chunkIndex += partLen;
  }

  machine.onMessage({
    family: machine.family
  , address: machine.address
  , port: machine.port
  , data: buf
  });

  // TODO maybe just use maxlen of buffer
  machine.buf = null; // back to null
  machine.bufIndex = 0; // back to 0
};
machine.fns.addChunk = function (chunk) {
  machine.chunkIndex = 0;
  while (machine.chunkIndex < chunk.length) {
    console.log(machine.state);
    machine.fns[machine.states[machine.state]](chunk);
    machine.state += 1;
    machine.state %= machine.states_length;
  }
};

module.exports = machine;

process.on('uncaughtException', function () {
  debug(Buffer.from('0'));
});
