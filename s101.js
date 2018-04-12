const EventEmitter = require('events').EventEmitter
const util = require('util')
const SmartBuffer = require('smart-buffer').SmartBuffer
const winston = require('winston')

const S101_BOF = 0xFE
const S101_EOF = 0xFF
const S101_CE = 0xFD
const S101_XOR = 0x20
const S101_INV = 0xF8

const SLOT = 0x00

const MSG_EMBER = 0x0E

const CMD_EMBER = 0x00
const CMD_KEEPALIVE_REQ = 0x01
const CMD_KEEPALIVE_RESP = 0x02

const VERSION = 0x01

const FLAG_SINGLE_PACKET = 0xC0
const FLAG_FIRST_MULTI_PACKET = 0x80
const FLAG_LAST_MULTI_PACKET = 0x40
const FLAG_MULTI_PACKET = 0x00

const DTD_GLOW = 0x01
const DTD_VERSION_MAJOR = 0x02
const DTD_VERSION_MINOR = 0x1F

const CRC_TABLE = [
  0x0000, 0x1189, 0x2312, 0x329b, 0x4624, 0x57ad, 0x6536, 0x74bf,
  0x8c48, 0x9dc1, 0xaf5a, 0xbed3, 0xca6c, 0xdbe5, 0xe97e, 0xf8f7,
  0x1081, 0x0108, 0x3393, 0x221a, 0x56a5, 0x472c, 0x75b7, 0x643e,
  0x9cc9, 0x8d40, 0xbfdb, 0xae52, 0xdaed, 0xcb64, 0xf9ff, 0xe876,
  0x2102, 0x308b, 0x0210, 0x1399, 0x6726, 0x76af, 0x4434, 0x55bd,
  0xad4a, 0xbcc3, 0x8e58, 0x9fd1, 0xeb6e, 0xfae7, 0xc87c, 0xd9f5,
  0x3183, 0x200a, 0x1291, 0x0318, 0x77a7, 0x662e, 0x54b5, 0x453c,
  0xbdcb, 0xac42, 0x9ed9, 0x8f50, 0xfbef, 0xea66, 0xd8fd, 0xc974,
  0x4204, 0x538d, 0x6116, 0x709f, 0x0420, 0x15a9, 0x2732, 0x36bb,
  0xce4c, 0xdfc5, 0xed5e, 0xfcd7, 0x8868, 0x99e1, 0xab7a, 0xbaf3,
  0x5285, 0x430c, 0x7197, 0x601e, 0x14a1, 0x0528, 0x37b3, 0x263a,
  0xdecd, 0xcf44, 0xfddf, 0xec56, 0x98e9, 0x8960, 0xbbfb, 0xaa72,
  0x6306, 0x728f, 0x4014, 0x519d, 0x2522, 0x34ab, 0x0630, 0x17b9,
  0xef4e, 0xfec7, 0xcc5c, 0xddd5, 0xa96a, 0xb8e3, 0x8a78, 0x9bf1,
  0x7387, 0x620e, 0x5095, 0x411c, 0x35a3, 0x242a, 0x16b1, 0x0738,
  0xffcf, 0xee46, 0xdcdd, 0xcd54, 0xb9eb, 0xa862, 0x9af9, 0x8b70,
  0x8408, 0x9581, 0xa71a, 0xb693, 0xc22c, 0xd3a5, 0xe13e, 0xf0b7,
  0x0840, 0x19c9, 0x2b52, 0x3adb, 0x4e64, 0x5fed, 0x6d76, 0x7cff,
  0x9489, 0x8500, 0xb79b, 0xa612, 0xd2ad, 0xc324, 0xf1bf, 0xe036,
  0x18c1, 0x0948, 0x3bd3, 0x2a5a, 0x5ee5, 0x4f6c, 0x7df7, 0x6c7e,
  0xa50a, 0xb483, 0x8618, 0x9791, 0xe32e, 0xf2a7, 0xc03c, 0xd1b5,
  0x2942, 0x38cb, 0x0a50, 0x1bd9, 0x6f66, 0x7eef, 0x4c74, 0x5dfd,
  0xb58b, 0xa402, 0x9699, 0x8710, 0xf3af, 0xe226, 0xd0bd, 0xc134,
  0x39c3, 0x284a, 0x1ad1, 0x0b58, 0x7fe7, 0x6e6e, 0x5cf5, 0x4d7c,
  0xc60c, 0xd785, 0xe51e, 0xf497, 0x8028, 0x91a1, 0xa33a, 0xb2b3,
  0x4a44, 0x5bcd, 0x6956, 0x78df, 0x0c60, 0x1de9, 0x2f72, 0x3efb,
  0xd68d, 0xc704, 0xf59f, 0xe416, 0x90a9, 0x8120, 0xb3bb, 0xa232,
  0x5ac5, 0x4b4c, 0x79d7, 0x685e, 0x1ce1, 0x0d68, 0x3ff3, 0x2e7a,
  0xe70e, 0xf687, 0xc41c, 0xd595, 0xa12a, 0xb0a3, 0x8238, 0x93b1,
  0x6b46, 0x7acf, 0x4854, 0x59dd, 0x2d62, 0x3ceb, 0x0e70, 0x1ff9,
  0xf78f, 0xe606, 0xd49d, 0xc514, 0xb1ab, 0xa022, 0x92b9, 0x8330,
  0x7bc7, 0x6a4e, 0x58d5, 0x495c, 0x3de3, 0x2c6a, 0x1ef1, 0x0f78
]

function S101Codec () {
  var self = this
  S101Codec.super_.call(this)
  self.inbuf = new SmartBuffer()
  self.emberbuf = new SmartBuffer()
  self.escaped = false
}

util.inherits(S101Codec, EventEmitter)

S101Codec.prototype.dataIn = function (buf) {
  var self = this
  for (var i = 0; i < buf.length; i++) {
    var b = buf.readUInt8(i)
    if (self.escaped) {
      self.inbuf.writeUInt8(b ^ S101_XOR)
      self.escaped = false
    } else if (b === S101_CE) {
      self.escaped = true
    } else if (b === S101_BOF) {
      self.inbuf.clear()
      self.escaped = false
    } else if (b === S101_EOF) {
      self.inbuf.moveTo(0)
      self.handleFrame(self.inbuf)
      self.inbuf.clear()
    } else {
      self.inbuf.writeUInt8(b)
    }
  }
}

S101Codec.prototype.handleFrame = function (frame) {
  var self = this
  // console.log(frame.toBuffer());
  if (!validateFrame(frame.toBuffer())) {
    winston.error('dropping frame of length %d with invalid CRC',
      frame.length)
    return
  }

  var slot = frame.readUInt8()
  var message = frame.readUInt8()
  if (slot !== SLOT || message !== MSG_EMBER) {
    winston.error('dropping frame of length %d (not an ember frame; slot=%d, msg=%d)',
      frame.length, slot, message)
    return
  }

  var command = frame.readUInt8()
  if (command === CMD_KEEPALIVE_REQ) {
    winston.debug('received keepalive request')
    self.emit('keepaliveReq')
  } else if (command === CMD_KEEPALIVE_RESP) {
    winston.debug('received keepalive response')
    self.emit('keepaliveResp')
  } else if (command === CMD_EMBER) {
    self.handleEmberFrame(frame)
  } else {
    winston.error('dropping frame of length %d with unknown command %d',
      frame.length, command)
  }
}

S101Codec.prototype.handleEmberFrame = function (frame) {
  var self = this
  var version = frame.readUInt8()
  var flags = frame.readUInt8()
  var dtd = frame.readUInt8()
  var appBytes = frame.readUInt8()

  if (version !== VERSION) {
    winston.warn('Unknown ember frame version %d', version)
  }

  if (dtd !== DTD_GLOW) {
    winston.error('Dropping frame with non-Glow DTD')
    return
  }

  if (appBytes < 2) {
    winston.warn('Frame missing Glow DTD version')
    frame.skip(appBytes)
  } else {
    appBytes -= 2
    if (appBytes > 0) {
      frame.skip(appBytes)
      winston.warn('App bytes with unknown meaning left over')
    }
  }

  var payload = frame.readBuffer()
  payload = payload.slice(0, payload.length - 2)
  if (flags === FLAG_SINGLE_PACKET) {
    winston.debug('single ember packet')
    self.handleEmberPacket(SmartBuffer.fromBuffer(payload))
    self.emberbuf.clear()
  } else if (flags === FLAG_FIRST_MULTI_PACKET) {
    winston.debug('multi ember packet start')
    self.emberbuf.clear()
    self.emberbuf.writeBuffer(payload)
  } else if (flags === FLAG_LAST_MULTI_PACKET) {
    winston.debug('multi ember packet end')
    self.emberbuf.writeBuffer(payload)
    self.emberbuf.moveTo(0)
    self.handleEmberPacket(self.emberbuf)
    self.emberbuf.clear()
  } else {
    winston.debug('multi ember packet')
    self.emberbuf.writeBuffer(payload)
  }
}

S101Codec.prototype.handleEmberPacket = function (packet) {
  var self = this

  winston.debug('ember packet')
  // console.log(packet);
  self.emit('emberPacket', packet.toBuffer())
}

var makeBERFrame = function (flags, data) {
  var frame = new SmartBuffer()
  frame.writeUInt8(S101_BOF)
  frame.writeUInt8(SLOT)
  frame.writeUInt8(MSG_EMBER)
  frame.writeUInt8(CMD_EMBER)
  frame.writeUInt8(VERSION)
  frame.writeUInt8(flags)
  frame.writeUInt8(DTD_GLOW)
  frame.writeUInt8(2) // number of app bytes
  frame.writeUInt8(DTD_VERSION_MINOR)
  frame.writeUInt8(DTD_VERSION_MAJOR)
  frame.writeBuffer(data)
  return finalizeBuffer(frame)
}

S101Codec.prototype.encodeBER = function (data) {
  var frames = []
  var encbuf = new SmartBuffer()
  for (var i = 0; i < data.length; i++) {
    var b = data.readUInt8(i)
    if (b < S101_INV) {
      encbuf.writeUInt8(b)
    } else {
      encbuf.writeUInt8(S101_CE)
      encbuf.writeUInt8(b ^ S101_XOR)
    }

    if (encbuf.length >= 1024 && i < data.length - 1) {
      if (frames.length === 0) {
        frames.push(makeBERFrame(FLAG_FIRST_MULTI_PACKET, encbuf.toBuffer()))
      } else {
        frames.push(makeBERFrame(FLAG_MULTI_PACKET, encbuf.toBuffer()))
      }
      encbuf.clear()
    }
  }

  if (frames.length === 0) {
    frames.push(makeBERFrame(FLAG_SINGLE_PACKET, encbuf.toBuffer()))
  } else {
    frames.push(makeBERFrame(FLAG_LAST_MULTI_PACKET, encbuf.toBuffer()))
  }

  return frames
}

S101Codec.prototype.keepAliveRequest = function () {
  var packet = new SmartBuffer()
  packet.writeUInt8(S101_BOF)
  packet.writeUInt8(SLOT)
  packet.writeUInt8(MSG_EMBER)
  packet.writeUInt8(CMD_KEEPALIVE_REQ)
  return finalizeBuffer(packet)
}

S101Codec.prototype.keepAliveResponse = function () {
  var packet = new SmartBuffer()
  packet.writeUInt8(S101_BOF)
  packet.writeUInt8(SLOT)
  packet.writeUInt8(MSG_EMBER)
  packet.writeUInt8(CMD_KEEPALIVE_RESP)
  return finalizeBuffer(packet)
}

var finalizeBuffer = function (smartbuf) {
  var crc = (~calculateCRCCE(smartbuf.toBuffer().slice(1, smartbuf.length))) & 0xFFFF
  var crcHi = crc >> 8
  var crcLo = crc & 0xFF

  if (crcLo < S101_INV) {
    smartbuf.writeUInt8(crcLo)
  } else {
    smartbuf.writeUInt8(S101_CE)
    smartbuf.writeUInt8(crcLo ^ S101_XOR)
  }

  if (crcHi < S101_INV) {
    smartbuf.writeUInt8(crcHi)
  } else {
    smartbuf.writeUInt8(S101_CE)
    smartbuf.writeUInt8(crcHi ^ S101_XOR)
  }

  smartbuf.writeUInt8(S101_EOF)
  return smartbuf.toBuffer()
}

var calculateCRC = function (buf) {
  var crc = 0xFFFF
  for (var i = 0; i < buf.length; i++) {
    var b = buf.readUInt8(i)
    crc = ((crc >> 8) ^ CRC_TABLE[(crc ^ b) & 0xFF]) & 0xFFFF
  }
  return crc
}

var calculateCRCCE = function (buf) {
  var crc = 0xFFFF
  for (var i = 0; i < buf.length; i++) {
    var b = buf.readUInt8(i)
    if (b === S101_CE) {
      b = S101_XOR ^ buf.readUInt8(++i)
    }
    crc = ((crc >> 8) ^ CRC_TABLE[(crc ^ b) & 0xFF]) & 0xFFFF
  }
  return crc
}

var validateFrame = function (buf) {
  return calculateCRC(buf) === 0xF0B8
}

S101Codec.prototype.validateFrame = validateFrame

module.exports = S101Codec
